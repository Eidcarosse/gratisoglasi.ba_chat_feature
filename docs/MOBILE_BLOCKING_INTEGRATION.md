# Mobile Blocking Integration Guide

Complete specification of the user-blocking flow for the GratisOglasi Expo / React Native app.
Everything here is verified against the running implementation (chat service, main backend) and
against live end-to-end runs, not inferred from code reading alone.

**Audience:** mobile engineers implementing or updating block/unblock.
**Scope:** everything the app must do. No backend changes are required — the flow is complete and
tested server-side.

---

## 1. The mental model

Read this section before anything else. Most integration bugs come from getting one of these three
facts wrong.

### 1.1 A block is stored one-way but enforced both ways

The backend stores a single directed row per block:

```
{ blockerId: A, blockedId: B }
```

But it is **enforced bidirectionally**. While that row exists:

- A cannot message B, **and B cannot message A**.
- Neither can start a new conversation with the other.
- A is hidden from B's view of the site, **and B is hidden from A's**.

So "I blocked them" and "they blocked me" produce the same *restrictions*. They differ only in
what the UI should offer: the blocker can undo it; the blocked user cannot.

### 1.2 `BlockStatus` is always relative to the authenticated user

Every block-related response is framed from the perspective of whoever is asking:

```ts
type BlockStatus = {
  blockedByMe: boolean;   // I blocked them
  blockedByThem: boolean; // they blocked me
  canMessage: boolean;    // derived: !(blockedByMe || blockedByThem)
};
```

The same block produces mirror-image payloads for the two users. If A blocks B:

| Asking user | blockedByMe | blockedByThem | canMessage |
| ----------- | ----------- | ------------- | ---------- |
| A           | `true`      | `false`       | `false`    |
| B           | `false`     | `true`        | `false`    |

`canMessage` is derived server-side. This state is therefore **impossible** and indicates a
client-side parsing bug (almost always reading the wrong nesting level — see §4.2):

```json
{ "blockedByMe": false, "blockedByThem": false, "canMessage": false }
```

If both flags are false, `canMessage` is true.

### 1.3 The three UI states

Drive every block-aware screen off these three, in this order:

| State                       | Copy                              | Actions offered           |
| --------------------------- | --------------------------------- | ------------------------- |
| `blockedByMe`               | "You blocked this user"           | **Unblock**               |
| `blockedByThem`             | "This user blocked you"           | **No unblock action.** Optionally "Block back" / "Report" |
| `canMessage`                | —                                 | Normal messaging          |

Mutual block (`blockedByMe && blockedByThem`): lead with **Unblock** — it is the only button that
changes anything for this user — and note that the other user has also blocked them. Unblocking in
this case will **not** restore contact.

---

## 2. Authentication

### 2.1 Chat service (REST)

```
Authorization: Bearer <token>
```

The chat service has a pluggable verifier controlled by the `AUTH_MODE` env var:

| Mode  | Token is…                                        | Notes                                        |
| ----- | ------------------------------------------------ | -------------------------------------------- |
| `jwt` | a shared-secret JWT with a `sub` or `userId` claim (main-site user `_id`) | Production mode |
| `dev` | the raw user ObjectId, unverified                | Test environments only — identity is spoofable |

> **Confirm with backend which mode your target environment runs**, since the token you send
> differs. The current test cluster runs `dev`. Do not build against `dev` semantics and assume
> they carry to production.

All block routes require auth. The blocker's identity is always taken from the token, **never**
from a request body — sending someone else's id will not make them the blocker.

### 2.2 Socket.IO

The token goes in the **handshake auth object**, not a header:

```js
import { io } from "socket.io-client";

const socket = io(CHAT_SERVICE_URL, {
  auth: { token },              // NOT headers
  transports: ["websocket"],
});
```

An invalid or missing token **rejects the handshake** (`connect_error`), it does not connect-then-fail.

### 2.3 Main backend

The main backend has no auth of its own. For block-filtered content it needs to know who is asking,
so the app forwards the **same chat token** under a different header — see §7.

---

## 3. REST endpoints (chat service)

All are behind auth and validated. **None of the block routes are rate-limited**, so you may call
them freely on user action. Adjacent routes you will touch in this flow *are* limited — message
send at 30 per 10s, conversation create at 10 per 60s — and return `429 RATE_LIMITED`.

### 3.1 `GET /blocks` — both directions

Returns both lists in one call.

```json
{
  "blocks": [
    {
      "userId": "64b2f0c2a1d4e5f600000222",
      "displayName": "Jane Seller",
      "avatarUrl": "https://…/avatar.jpg",
      "createdAt": "2026-07-06T12:00:00.000Z"
    }
  ],
  "blockedBy": ["64b2f0c2a1d4e5f600000333"]
}
```

| Field       | Type       | Meaning |
| ----------- | ---------- | ------- |
| `blocks`    | object[]   | Users **I** blocked, newest first, hydrated with display data. Drives the Block/Unblock toggle. |
| `blockedBy` | string[]   | **Ids only** of users who blocked me. |

`blockedBy` is intentionally ids-only. It exists so the client can gate composers and hide content.
Do not build a named "these users blocked you" screen from it.

Both lists are projections of the same stored rows, so they can never disagree, and one block or
unblock is always reflected on both sides.

**Call this once per session init** (and after re-login). Between loads, keep both lists current
from the `block:update` socket event (§4). **Do not poll this endpoint.**

Read `blockedBy` defensively — `response.blockedBy || []` — so the app still works against a chat
service deployed before this field existed.

### 3.2 `GET /blocks/status/:userId` — one pair

```json
{ "status": { "blockedByMe": false, "blockedByThem": false, "canMessage": true } }
```

Use when opening a profile or a "Contact seller" button where you have no conversation yet.

### 3.3 `POST /blocks` — block a user

Request `{ "userId": "OTHER_USER_ID" }` → **201**

```json
{ "ok": true, "status": { "blockedByMe": true, "blockedByThem": false, "canMessage": false } }
```

Idempotent — re-blocking the same user returns 201 again and keeps exactly one row.

### 3.4 `DELETE /blocks/:userId` — unblock

→ **200**

```json
{ "ok": true, "status": { "blockedByMe": false, "blockedByThem": false, "canMessage": true } }
```

Idempotent — unblocking someone you never blocked is a 200, not an error.

> **`canMessage` is not guaranteed `true` after an unblock.** If the other user still blocks you,
> the response is `{ blockedByMe: false, blockedByThem: true, canMessage: false }`. Always apply
> the returned status rather than assuming the unblock restored contact. This is the single most
> commonly mishandled case.

### 3.5 Errors

Every chat-service error uses one envelope:

```json
{ "error": { "code": "VALIDATION", "message": "You cannot block yourself" } }
```

| HTTP | `code`            | When |
| ---- | ----------------- | ---- |
| 400  | `VALIDATION`      | Blocking yourself; malformed `userId` (not an ObjectId) |
| 401  | `UNAUTHENTICATED` | Missing/invalid/expired token |
| 403  | `FORBIDDEN`       | Send or conversation-create against a blocked pair |
| 404  | `NOT_FOUND`       | Target user does not exist |
| 429  | `RATE_LIMITED`    | Never on block routes; possible on message-send and conversation-create |

---

## 4. The `block:update` socket event

**This is the section to get right.** It is what keeps state live and multi-device consistent.

### 4.1 Semantics

- Emitted on **every** block and unblock.
- Sent to **both** users — the blocker *and* the blocked user — each framed from their own
  perspective. The blocked user receives it without taking any action.
- Delivered to the `user:<id>` room, so **all of a user's devices** receive it. Blocking on the web
  updates the phone, and vice versa.

### 4.2 The payload is flat — unlike REST

```json
{
  "userId": "OTHER_USER_ID",
  "blockedByMe": false,
  "blockedByThem": true,
  "canMessage": false
}
```

REST nests the same fields under `status`; the socket event does **not**. Reading
`payload.status` here (or `response.data` there) yields `undefined` for all three booleans, which
coerce to the impossible all-false state from §1.2. Normalize both into one shape at the boundary:

```js
const normalizeBlockStatus = (raw) => {
  const blockedByMe = Boolean(raw?.blockedByMe);
  const blockedByThem = Boolean(raw?.blockedByThem);
  return { blockedByMe, blockedByThem, canMessage: !(blockedByMe || blockedByThem) };
};

// REST
setBlockStatus(normalizeBlockStatus(response.data.status));

// Socket
socket.on("block:update", ({ userId, ...rest }) => {
  applyBlockStatus(userId, normalizeBlockStatus(rest));
});
```

Deriving `canMessage` locally rather than trusting the wire value makes the two sources agree even
if one omits it.

---

## 5. Client state model

### 5.1 Two sets, three update paths

Hold two `id → true` maps:

| Set               | Source of truth        | Meaning |
| ----------------- | ---------------------- | ------- |
| `blockedUsers`    | `GET /blocks`.`blocks` | Users I blocked |
| `blockedByUsers`  | `GET /blocks`.`blockedBy` | Users who blocked me |

Both are fed by exactly three paths — implement all three:

1. **Session init** — `GET /blocks` populates both. Also re-run after re-login, so blocks rehydrate
   for the new session.
2. **`block:update`** — `blockedByMe` adds/removes from `blockedUsers`; `blockedByThem` adds/removes
   from `blockedByUsers`. One event maintains both directions.
3. **Block/unblock responses** — apply the returned `status` the same way.

```js
function applyBlockStatus(userId, status) {
  setBlockedUsers((prev) => toggle(prev, userId, status.blockedByMe));
  setBlockedByUsers((prev) => toggle(prev, userId, status.blockedByThem));
  updateConversationsWithOtherUser(userId, status);
}

const toggle = (map, id, on) => {
  const next = { ...map };
  if (on) next[id] = true;
  else delete next[id];
  return next;
};
```

### 5.2 Always replace, never partial-merge

```js
setBlockStatus(normalizeBlockStatus(response.data.status));      // correct

setBlockStatus((prev) => ({ ...prev, blockedByMe: false }));     // wrong
```

Partial merges leave stale values behind, most visibly after an unblock.

### 5.3 Reconciling conversation payloads against the lists

Conversations arrive carrying their own `blockStatus`. Reconcile them against the central lists,
with one deliberate asymmetry:

- **`blockedByMe`** — the list **overrides** the payload. A cached or post-re-login payload can
  carry a stale value; the list cannot.
- **`blockedByThem`** — take the **union** of the list and the payload, never an override.

The reason for the asymmetry: reconciliation can run before `GET /blocks` has resolved, and
deriving `false` from a not-yet-populated map would erase a `true` the payload correctly carried.
Clearing an incoming block always arrives via `block:update`, so nothing gets stuck on.

```js
const blockedByMe = Boolean(blockedUsers[otherUserId]);
const blockedByThem =
  Boolean(blockedByUsers[otherUserId]) || Boolean(conversation.blockStatus?.blockedByThem);
```

This mirrors the web implementation and is covered by its regression tests.

---

## 6. What the backend enforces regardless of your UI

Your UI gating is a UX affordance. These are the hard guarantees — treat every 403 as a defensive
fallback that should be handled gracefully, not as the primary gate.

| Action                          | Blocked behaviour |
| ------------------------------- | ----------------- |
| Send message (REST)             | **403 `FORBIDDEN`** |
| Send message (`message:send` socket) | **403 `FORBIDDEN`** — same write path, delivered in the ack |
| Create conversation             | **403 `FORBIDDEN`** |
| Read existing history           | **Allowed** — 200, history stays readable |
| `GET /conversations/:id`        | **200** with `blockStatus.canMessage: false` |
| `GET /conversations` (inbox)    | **200**, each row carries a caller-relative `blockStatus` |
| Push notifications              | Never sent — the send was already refused upstream |

Both directions are refused. The *blocker* cannot message the person they blocked either.

Socket send errors arrive in the acknowledgement callback, not as an exception:

```js
socket.emit("message:send", payload, (ack) => {
  if (!ack.ok && ack.error?.code === "FORBIDDEN") {
    // refresh block status for this pair and lock the composer
  }
});
```

Existing conversations with a blocked user remain visible in the inbox with their history — do not
hide or delete them. Replace the composer with the appropriate notice from §1.3.

---

## 7. Main backend: withholding profiles and ads

**This is the part most likely to be missed, and skipping it means the app keeps showing blocked
users' profiles and ads.**

The main backend (ads, users) is a separate service with no auth. To honour blocks it must learn
who is asking, so the app forwards the chat token under a dedicated header.

### 7.1 Headers

```js
function mainBackendHeaders({ bypassCache = false } = {}) {
  const headers = {};
  const token = getChatAccessToken();
  if (token) headers["X-Chat-Auth"] = `Bearer ${token}`;
  if (bypassCache) headers["Cache-Control"] = "no-cache";
  return headers;
}
```

- Omit the header entirely for logged-out users — those requests are unfiltered by design.
- The backend caches block status for ~5 seconds per token+target. Send
  `Cache-Control: no-cache` on the **refetch immediately after an unblock**, otherwise the content
  can stay hidden for a few more seconds.

### 7.2 Guarded routes

Confirmed live:

| Route | Withheld when |
| ----- | ------------- |
| `GET /user/get/:id` | a block exists either way with `:id` |
| `GET /item/getItemAndUser/:id` | a block exists either way with the ad's seller |
| `POST /item/findItem` with `query.addedBy` | a block exists either way with that owner |

### 7.3 The 403 body

```json
{
  "blocked": true,
  "reason": "blocked_by_me",
  "blockedByMe": true,
  "blockedByThem": false,
  "userId": "64b2f0c2a1d4e5f600000222"
}
```

Branch on the **two booleans**, not on `reason` — `reason` collapses the mutual case into
`blocked_by_me`. Check `blocked === true` before treating a 403 as a block, so an unrelated 403
never renders the blocked screen.

```js
function blockedStatusFrom(error) {
  const res = error?.response;
  if (res?.status !== 403 || !res.data?.blocked) return null;
  return {
    blockedByMe: Boolean(res.data.blockedByMe),
    blockedByThem: Boolean(res.data.blockedByThem),
    userId: res.data.userId ?? null,
  };
}
```

### 7.4 The blocked placeholder screen

Render in place of the withheld profile or seller card, with three variants:

| Case | Copy | Actions |
| ---- | ---- | ------- |
| You blocked them | "You blocked this user" | **Unblock** (then refetch with `no-cache`) |
| They blocked you | "This user blocked you" | **Block back**, Report. No unblock. |
| Both | Lead with your own block, note theirs | **Unblock** — but the content stays hidden, since their block still stands |

After **unblock**, refetch with `Cache-Control: no-cache`. After **block back**, do **not** refetch —
their block still withholds the content; only update the copy.

### 7.5 Two behaviours to design around

- **Fail-open.** If the chat service is unreachable or the token is stale, the main backend returns
  the content rather than hiding it. This is deliberate: these pages are already public to anonymous
  visitors, so failing closed would make every public profile depend on chat-service uptime. The app
  may therefore briefly show a blocked user's profile during an outage. Do not add client-side
  retries to "fix" this.
- **Feeds are not filtered.** General search, home and category listings are **not** block-filtered —
  only single-ad and owner-scoped (`addedBy`) queries are. A blocked seller's ads *will* still appear
  in browse results; opening one shows the blocked placeholder. This is a deliberate performance
  trade-off (one chat-service hop per request, max). Do not build UI that assumes a clean feed.

---

## 8. Implementation checklist

Build in this order — each step is usable on its own.

1. **Session bootstrap** — `GET /blocks` on init and after re-login; populate `blockedUsers` and
   `blockedByUsers`. Clear both on logout.
2. **Socket listener** — subscribe to `block:update`; normalize the flat payload; update both sets
   and any open conversation.
3. **Block / unblock actions** — from the chat kebab menu and the profile menu. Apply the returned
   `status`; do not optimistically assume the result.
4. **Composer gating** — enable only on `canMessage === true`; otherwise show the §1.3 notice.
   Handle a `FORBIDDEN` ack/response as a fallback.
5. **Inbox** — consume each row's `blockStatus`; keep blocked conversations visible with history.
6. **Main-backend header** — add `X-Chat-Auth` to profile/ad/owner-listing requests.
7. **Blocked placeholder screen** — all three variants, with the refetch rules from §7.4.
8. **Multi-device** — confirm a block on another device updates this one live.

## 9. Test matrix

Every row below was verified against the live backend, so a correct client will reproduce all of
them.

| # | Scenario | Expected |
| - | -------- | -------- |
| 1 | Baseline, no block | `GET /blocks` both keys empty; `canMessage: true` |
| 2 | A blocks B | A: `blockedByMe:true`. B: `blockedByThem:true` — the mirror |
| 3 | A's lists | `blocks` has B; `blockedBy` empty |
| 4 | B's lists | `blocks` empty; `blockedBy` has A — **without B doing anything** |
| 5 | A sends | 403 `FORBIDDEN` |
| 6 | B sends | 403 `FORBIDDEN` — bidirectional |
| 7 | Either starts a new conversation | 403 |
| 8 | Existing history | Still readable, 200 |
| 9 | B's live socket at the moment A blocks | `block:update` with `blockedByThem:true` |
| 10 | A's second device | Same `block:update`, A's own perspective |
| 11 | Re-block same user | 201, still one entry in the list |
| 12 | Block self | 400 `VALIDATION` |
| 13 | Block unknown user id | 404 `NOT_FOUND` |
| 14 | Block malformed id | 400 `VALIDATION` |
| 15 | Mutual block | Each user: one entry in each list, both flags true |
| 16 | A unblocks (no reverse block) | `canMessage:true`; both lists clear on both sides |
| 17 | A unblocks (B still blocks A) | `{ blockedByMe:false, blockedByThem:true, canMessage:false }` |
| 18 | Unblock a non-blocked user | 200, no error |
| 19 | Profile of blocked user (main backend, with header) | 403 `{ blocked:true }` |
| 20 | Same profile, no `X-Chat-Auth` | 200 — anonymous is unfiltered |
| 21 | Same profile, after unblock + `no-cache` | 200 |
| 22 | Chat service down, profile request | 200 — fail-open |
| 23 | Blocked seller's ad in general feed | Still listed — known non-goal |

---

## 10. Quick reference

### Chat service

| Method | Path | Body | Response |
| ------ | ---- | ---- | -------- |
| GET  | `/blocks` | — | `200 { blocks: [{userId, displayName, avatarUrl, createdAt}], blockedBy: [userId] }` |
| GET  | `/blocks/status/:userId` | — | `200 { status: BlockStatus }` |
| POST | `/blocks` | `{ userId }` | `201 { ok: true, status: BlockStatus }` |
| DELETE | `/blocks/:userId` | — | `200 { ok: true, status: BlockStatus }` |
| GET  | `/conversations` | — | `200 { conversations: [{ …, blockStatus }] }` |
| GET  | `/conversations/:id` | — | `200 { conversation: { …, blockStatus } }` |
| POST | `/conversations` | `{ itemId }` | `201 { conversation }` · **403 if blocked** |
| POST | `/conversations/:id/messages` | `{ clientMessageId, type, body }` | `201 { message }` · **403 if blocked** |

Auth: `Authorization: Bearer <token>`. Errors: `{ error: { code, message } }`.

### Socket

| Event | Direction | Payload |
| ----- | --------- | ------- |
| `block:update` | Server → both users, all devices | `{ userId, blockedByMe, blockedByThem, canMessage }` — **flat** |
| `message:send` | Client → server | ack `{ ok: false, error: { code: "FORBIDDEN" } }` if blocked |

Auth: `io(url, { auth: { token } })`.

### Main backend

| Method | Path | Withheld when |
| ------ | ---- | ------------- |
| GET  | `/user/get/:id` | block either way with `:id` |
| GET  | `/item/getItemAndUser/:id` | block either way with the seller |
| POST | `/item/findItem` (`query.addedBy`) | block either way with that owner |

Auth: `X-Chat-Auth: Bearer <chat token>` (+ `Cache-Control: no-cache` after unblock).
403 body: `{ blocked: true, reason, blockedByMe, blockedByThem, userId }`.

---

## Related documents

- [`FRONTEND_CHAT_INTEGRATION.md`](./FRONTEND_CHAT_INTEGRATION.md) §5.12–5.15 — full chat API reference (same folder)
- `GratisOglasi/docs/BLOCK_UNBLOCK_FRONTEND_FLOW.md` — web equivalent of this guide
- `gratis-oglasi-system-docs/API_AND_FRONTEND_INTEGRATION.md` — cross-system endpoint index

Keep this file in step with the web guide when the flow changes, so the two clients cannot drift.
