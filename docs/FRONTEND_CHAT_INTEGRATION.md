# Gratis Oglasi — Chat Frontend Integration Spec

> **Audience:** the React Native / Expo team building the chat client.
> **Purpose:** a single, unambiguous contract for the chat backend
> (`gratisoglasi.ba_chat_feature`). Everything you need to implement the client —
> transport, auth, every REST route, every Socket.IO event, exact request/response/payload
> shapes, the error contract, and the client-side rules the server assumes you follow — is
> here. You should **not** need to read server code.
>
> **Scope of this document:** contract reference, not a client implementation. Code
> appears only as short illustrative snippets. Examples assume **dev-mode auth**
> (`AUTH_MODE=dev`), where the token is the raw `userId`. See [§2](#2-connection--authentication)
> for the production JWT swap (identical wiring).

---

## Table of contents

1. [Overview & architecture](#1-overview--architecture)
2. [Connection & authentication](#2-connection--authentication)
3. [Core concepts the client MUST honor](#3-core-concepts-the-client-must-honor)
4. [Data models](#4-data-models)
5. [REST API reference](#5-rest-api-reference)
6. [Socket.IO event reference](#6-socketio-event-reference)
7. [End-to-end flows](#7-end-to-end-flows)
8. [Error handling & reconnect strategy](#8-error-handling--reconnect-strategy)
9. [Recommended RN client shape](#9-recommended-rn-client-shape)
10. [Appendix: quick reference & config](#10-appendix-quick-reference--config)

---

## 1. Overview & architecture

The chat backend is a standalone Node service. It exposes **two coordinated transports
over the same origin**:

| Transport | Use it for | Notes |
| --------- | ---------- | ----- |
| **REST (HTTP/JSON)** | Inbox list, find-or-create conversation, open conversation, message **history** (pagination), file presign. Also a REST **fallback** for sending. | Stateless. One request → one response. |
| **Socket.IO (WebSocket)** | Live send/receive, typing, read/delivery receipts, presence, reconnect sync. | Single persistent connection. `transports: ['websocket']` only — **no HTTP long-polling fallback**. |

Both transports are backed by the **same service layer**: sending a message via REST or via
the socket runs identical validation, idempotency, and side effects. The socket is the
primary path; REST send exists for environments where the socket is unavailable.

**Stack (informational):** Socket.IO `4.7.5`, Express `4.19`, MongoDB / Mongoose `8.4`. The
service reads marketplace data (users, items) from the main site's DB read-only; you never
touch that DB — item/user info arrives pre-joined in conversation payloads.

**Base URL.** Default server port is **`3000`**. There is no global API path prefix — routes
mount at the root (`/conversations`, `/uploads`, …). Throughout this doc the base is written
as `{BASE_URL}` (e.g. `http://localhost:3000` in dev, your gateway URL in prod). The
Socket.IO endpoint is the **same origin** as REST.

---

## 2. Connection & authentication

### 2.1 The token

Authentication is a single opaque **token** string, sent two ways:

- **REST:** HTTP header `Authorization: Bearer <token>`
- **Socket.IO:** the handshake `auth` object — `auth: { token: "<token>" }`

**Dev mode (`AUTH_MODE=dev`, assumed by all examples here):** the token **is the raw
`userId`** — a 24-hex MongoDB ObjectId string, e.g. `64b2f0c2a1d4e5f600000abc`. There is no
signature; it is trusted as-is. This is for local development only.

**Production (`AUTH_MODE=jwt`):** the token is a signed **JWT** whose payload contains
`{ userId }`. **The wiring is identical** — same header, same handshake `auth.token`. Only the
string's content changes. Build your client so the token is an injectable value; switching
dev→prod is a config change, not a code change.

> **Security rule you must respect:** the server derives the caller's identity **only** from
> the authenticated token (`req.userId` / `socket.userId`). Any `userId`/`senderId` you put in
> a request body or socket payload is **ignored** — the server overwrites it with the
> authenticated identity. Never rely on client-supplied identity. Authorization (am I a member
> of this conversation?) is enforced on **every** operation.

### 2.2 Opening the socket

```js
import { io } from 'socket.io-client';

const socket = io(BASE_URL, {
  transports: ['websocket'],   // REQUIRED — server accepts websocket only
  auth: { token },             // dev: token === userId ; prod: signed JWT
  autoConnect: true,
});

socket.on('connect', () => { /* connected; server has joined your rooms */ });
socket.on('connect_error', (err) => { /* bad/missing token rejects the handshake */ });
```

On a successful handshake the server automatically:
- joins your personal room and the rooms of all your existing conversations, and
- broadcasts your **online** presence to the other participants in those conversations.

You do **not** join or subscribe to rooms manually — room membership is server-managed. (Room
names `user:<userId>` and `conv:<conversationId>` are internal; listed only for context.)

A bad or missing token rejects the handshake — handle `connect_error`.

---

## 3. Core concepts the client MUST honor

These are not optional style choices; the server's behavior assumes them.

### 3.1 `clientMessageId` — idempotency (REQUIRED on every send)

Every message you send (socket **or** REST) must carry a **UUID v4** `clientMessageId` that
**you** generate before sending. It is the idempotency key:

- The store has a **unique index** on `(conversationId, clientMessageId)`. Re-sending the same
  `clientMessageId` returns the **existing** message instead of creating a duplicate.
- This makes retries safe: if a send times out, resend with the **same** `clientMessageId`.
- It is also how you reconcile **optimistic** UI: render the outgoing message immediately keyed
  by `clientMessageId`; when the server's `message:new` / ack arrives carrying the same
  `clientMessageId`, replace your optimistic copy (now you have the real `_id` and `createdAt`).

Generate it client-side, e.g. with `react-native-uuid` or `expo-crypto`'s `randomUUID()`.

### 3.2 History vs. sync — two different orderings

| Operation | Transport | Cursor | Order returned |
| --------- | --------- | ------ | -------------- |
| **History** (scroll back) | `GET …/messages?before=<id>` | `before` = oldest message `_id` you currently hold | **newest-first** (descending `_id`) |
| **Sync** (after reconnect) | socket `conversation:sync` | per-conversation = newest `_id` you hold | **oldest-first** (ascending `_id`), only messages newer than the cursor |

Both use **keyset pagination on `_id`** (ObjectIds are time-sortable). Never use offset/skip.
Mind the orderings differ — history descends, sync ascends.

### 3.3 Message status model

A `Message.status` is always the single value `'sent'`. **Delivered/read state does NOT live on
the message.** It lives on the **conversation**:
- `conversation.unreadCounts[userId]` — per-user unread count.
- `conversation.readState[userId]` — `{ lastReadMessageId, lastReadAt }` watermark per user.
- Delivery receipts (`message:delivered`) are **relayed live but not persisted** — treat them
  as transient UI hints.

To render "✓ read" you compare a message's `_id` against the other participant's
`readState[otherUserId].lastReadMessageId`.

### 3.4 Typing is best-effort & ephemeral

`typing:start` / `typing:stop` are never persisted and have **no ack**. Throttle emits
(~2–3 s) and run a local timeout that clears the indicator if a `typing:stop` is lost.

### 3.5 Rate limits → handle `429` / `RATE_LIMITED`

| Action | Limit |
| ------ | ----- |
| Send message | **30 per 10 s** per user |
| Create conversation | **10 per 60 s** per user |
| Default (other endpoints) | **300 per 60 s** per user |

Exceeding a limit returns HTTP `429` (REST) or an ack `error.code === 'RATE_LIMITED'` (socket).
Back off and retry; do not hammer.

---

## 4. Data models

TypeScript-style interfaces describing exactly what the API returns. All `*Id` fields are
24-hex ObjectId **strings** over the wire. All timestamps are **ISO-8601 strings**.

```ts
type MessageType = 'text' | 'image' | 'file';
type MessageStatus = 'sent';                 // always 'sent' (see §3.3)

interface Attachment {
  key: string;        // object key returned by POST /uploads/presign
  url: string;        // public URL of the uploaded object (valid URL)
  mime: string;       // e.g. "image/png"
  size: number;       // bytes, integer >= 0
  width?: number;     // integer > 0 (images)
  height?: number;    // integer > 0 (images)
}

interface Message {
  _id: string;                 // server-assigned; ALSO the sort/pagination key
  conversationId: string;
  senderId: string;            // authoritative sender (from auth, not client input)
  clientMessageId: string;     // the UUID v4 YOU generated (idempotency / reconcile key)
  type: MessageType;
  body: string;                // text content ('' for non-text). HTML-escaped server-side.
  attachments: Attachment[];   // [] when none ([] after an unsend)
  status: MessageStatus;       // 'sent'
  deletedAt: string | null;    // ISO-8601 when unsent ("deleted for everyone"); body+attachments cleared
  createdAt: string;           // ISO-8601
}

interface ItemSnapshot {       // marketplace item, snapshotted at conversation creation
  title: string;
  thumbnailUrl: string | null;
  price: number | null;
  status: string;              // moderation status: 'Pending' | 'Review' | 'Approved'
  sellerId: string;
}

interface ParticipantSummary {
  displayName: string;
  avatarUrl: string;
}

interface ReadStateEntry {
  lastReadMessageId: string | null;
  lastReadAt: string;          // ISO-8601
}

interface Conversation {
  _id: string;
  itemId: string;
  pairKey: string;                       // "<buyerId>:<sellerId>" — internal dedup key
  participantIds: [string, string];      // deterministic order: [buyerId, sellerId]
  item: ItemSnapshot;                     // snapshot; refreshed only on GET-one (see below)
  participants: Record<string, ParticipantSummary>;   // keyed by userId
  lastMessage: {
    messageId: string;                    // id of the previewed message
    body: string;                         // "[image]"/"[file]" for non-text; "" if unsent
    senderId: string;
    type: MessageType;
    createdAt: string;
    deletedAt: string | null;             // set if the previewed message was unsent
  } | null;                               // null until first message
  unreadCounts: Record<string, number>;   // keyed by userId
  readState: Record<string, ReadStateEntry>; // keyed by userId
  mutedBy: string[];                       // userIds who muted push for this convo
  createdAt: string;
  updatedAt: string;                       // inbox is sorted by this, desc
  // expiresAt (createdAt + 7d, TTL) and deletedFor[] also exist server-side; the inbox already
  // omits conversations YOU deleted, so deletedFor is not something the client needs to read.

  // Present ONLY on GET /conversations/:id (live overlay; not stored):
  itemLive?: { price: number | null; status: string; hidden: boolean };
}
```

**Snapshot vs. live.** `conversation.item` is captured when the conversation is created and is
**not** kept in sync. The inbox list (`GET /conversations`) returns the stored snapshot only.
Opening a single conversation (`GET /conversations/:id`) refreshes `item.price`/`status`/
`thumbnailUrl` from the live marketplace item and adds `itemLive` (including `hidden`). Use
`itemLive` to show "price changed" / "listing removed" banners.

---

## 5. REST API reference

Common to **all** routes:
- Header `Authorization: Bearer <token>` is **required**. Missing/invalid → `401`
  `UNAUTHENTICATED`.
- Request bodies are JSON; max body size **256 kB**.
- Errors always use the shape in [§8](#8-error-handling--reconnect-strategy).
- IDs in paths/bodies must be valid 24-hex ObjectIds or you get `400 VALIDATION` /
  `404 NOT_FOUND`.

### 5.1 `GET /conversations` — inbox

List the authenticated user's conversations, **snapshot only**, sorted by `updatedAt`
descending.

- **Auth:** required.
- **Params / query / body:** none.
- **200 response:**

```json
{
  "conversations": [
    {
      "_id": "64b2f0c2a1d4e5f600000abc",
      "itemId": "64b2f0c2a1d4e5f600000111",
      "pairKey": "64b2f0c2a1d4e5f600000aaa:64b2f0c2a1d4e5f600000bbb",
      "participantIds": ["64b2f0c2a1d4e5f600000aaa", "64b2f0c2a1d4e5f600000bbb"],
      "item": {
        "title": "Mountain bike, 27.5\"",
        "thumbnailUrl": "https://cdn.example.com/items/abc-thumb.jpg",
        "price": 250,
        "status": "Approved",
        "sellerId": "64b2f0c2a1d4e5f600000bbb"
      },
      "participants": {
        "64b2f0c2a1d4e5f600000aaa": { "displayName": "Adnan B.", "avatarUrl": "https://cdn.example.com/u/aaa.jpg" },
        "64b2f0c2a1d4e5f600000bbb": { "displayName": "Mirza K.", "avatarUrl": "https://cdn.example.com/u/bbb.jpg" }
      },
      "lastMessage": {
        "messageId": "64b2f0c2a1d4e5f600000f10",
        "body": "Is it still available?",
        "senderId": "64b2f0c2a1d4e5f600000aaa",
        "type": "text",
        "createdAt": "2026-06-24T10:05:00.000Z",
        "deletedAt": null
      },
      "unreadCounts": { "64b2f0c2a1d4e5f600000aaa": 0, "64b2f0c2a1d4e5f600000bbb": 1 },
      "readState": {
        "64b2f0c2a1d4e5f600000aaa": { "lastReadMessageId": "64b2f0c2a1d4e5f600000f01", "lastReadAt": "2026-06-24T10:05:01.000Z" }
      },
      "mutedBy": [],
      "createdAt": "2026-06-24T09:00:00.000Z",
      "updatedAt": "2026-06-24T10:05:00.000Z"
    }
  ]
}
```

### 5.2 `POST /conversations` — find-or-create ("Contact seller")

Idempotently get the one conversation between the authenticated **buyer** and the item's
seller for a given item. If it already exists, the existing one is returned.

- **Auth:** required. **Rate-limited: 10 / 60 s.**
- **Request body:**

```json
{ "itemId": "64b2f0c2a1d4e5f600000111" }
```

| Field | Type | Rules |
| ----- | ---- | ----- |
| `itemId` | string (24-hex) | Required. The marketplace item being asked about. |

> The **seller is derived from the item** server-side — you do **not** send a seller/recipient
> id. The buyer is the authenticated user.

- **201 response:** `{ "conversation": Conversation }` (shape as in §4; no `itemLive`).
- **Error cases:**
  - Item does not exist → `404 NOT_FOUND`.
  - Item hidden/unavailable → `403 FORBIDDEN`.
  - Item has no seller → `400 VALIDATION`.
  - You are the seller (buyer == seller) → `400 VALIDATION`
    ("You cannot start a conversation with yourself").
  - Over rate limit → `429 RATE_LIMITED`.

### 5.3 `GET /conversations/:conversationId` — open one (live overlay)

Fetch one conversation with the marketplace item **refreshed live**.

- **Auth:** required. Caller must be a participant, else `403 FORBIDDEN`.
- **Path param:** `conversationId` (24-hex).
- **200 response:** `{ "conversation": Conversation }` where `item.price`/`status`/
  `thumbnailUrl` reflect the current listing **and** an extra `itemLive` is present:

```json
{
  "conversation": {
    "_id": "64b2f0c2a1d4e5f600000abc",
    "itemId": "64b2f0c2a1d4e5f600000111",
    "item": { "title": "Mountain bike, 27.5\"", "thumbnailUrl": "https://cdn.example.com/items/abc-thumb.jpg", "price": 230, "status": "Approved", "sellerId": "64b2f0c2a1d4e5f600000bbb" },
    "itemLive": { "price": 230, "status": "Approved", "hidden": false },
    "participantIds": ["64b2f0c2a1d4e5f600000aaa", "64b2f0c2a1d4e5f600000bbb"],
    "participants": { "...": "..." },
    "lastMessage": { "...": "..." },
    "unreadCounts": { "...": 0 },
    "readState": { "...": {} },
    "createdAt": "2026-06-24T09:00:00.000Z",
    "updatedAt": "2026-06-24T10:05:00.000Z"
  }
}
```

- **Error cases:** not a participant → `403 FORBIDDEN`; unknown/invalid id → `404 NOT_FOUND`.

### 5.4 `GET /conversations/:conversationId/messages` — history (paginated)

Fetch a page of messages, **newest-first**, with keyset pagination.

- **Auth:** required. Must be a participant.
- **Path param:** `conversationId` (24-hex).
- **Query params:**

| Param | Type | Rules |
| ----- | ---- | ----- |
| `before` | string (24-hex) | Optional cursor. Returns messages with `_id < before`. Pass the **oldest** `_id` you currently hold to page further back. Omit for the first/newest page. |
| `limit` | integer | Optional. `1`–`100`. **Default `50`.** |

- **Example:** `GET {BASE_URL}/conversations/64b2f0c2a1d4e5f600000abc/messages?before=64b2f0c2a1d4e5f600000f10&limit=30`
- **200 response:** `{ "messages": Message[] }` — **descending `_id`** (newest first):

```json
{
  "messages": [
    {
      "_id": "64b2f0c2a1d4e5f600000f20",
      "conversationId": "64b2f0c2a1d4e5f600000abc",
      "senderId": "64b2f0c2a1d4e5f600000bbb",
      "clientMessageId": "9f1c0b3e-2c2a-4e7a-9b9a-1d2e3f4a5b6c",
      "type": "text",
      "body": "Yes, still available.",
      "attachments": [],
      "status": "sent",
      "deletedAt": null,
      "createdAt": "2026-06-24T10:06:00.000Z"
    }
  ]
}
```

> **Rendering tip:** reverse the page for display (chat shows oldest→newest top→bottom). Detect
> "end of history" when a page returns fewer than `limit` items.

### 5.5 `POST /conversations/:conversationId/messages` — send (REST fallback)

Send a message over REST. Behaves **identically** to the socket `message:send` (same
validation, same idempotency, same side effects). Prefer the socket when connected; use this
when the socket is unavailable.

- **Auth:** required. Must be a participant. **Rate-limited: 30 / 10 s.**
- **Path param:** `conversationId` (24-hex).
- **Request body:**

```json
{
  "clientMessageId": "9f1c0b3e-2c2a-4e7a-9b9a-1d2e3f4a5b6c",
  "type": "text",
  "body": "Hello, is the price negotiable?",
  "attachments": []
}
```

| Field | Type | Rules |
| ----- | ---- | ----- |
| `clientMessageId` | string | **Required. UUID v4.** Idempotency key (see §3.1). |
| `type` | `"text"` \| `"image"` \| `"file"` | Required. |
| `body` | string | Trimmed length **1–4000**. **Required & non-empty when `type === "text"`**; optional otherwise. HTML-escaped server-side. |
| `attachments` | `Attachment[]` | Optional. Each: `{ key, url, mime, size, width?, height? }` — `url` must be a valid URL, `size` an int ≥ 0, `width`/`height` ints > 0. |

- **201 response:** `{ "message": Message }` (the persisted message, with its real `_id`,
  `createdAt`, and the same `clientMessageId` you sent).
- **Error cases:** validation → `400 VALIDATION` (e.g. text with empty body, bad UUID, body
  > 4000); not a participant → `403 FORBIDDEN`; over limit → `429 RATE_LIMITED`.

> Sending a duplicate `clientMessageId` is **not** an error — you get the original message back.

### 5.6 `POST /uploads/presign` — presigned upload for attachments

Get a short-lived presigned **PUT** URL so the client uploads bytes **directly** to object
storage (DigitalOcean Spaces / S3); the chat server never handles the file.

- **Auth:** required.
- **Request body:**

```json
{ "mime": "image/png", "size": 184320, "filename": "photo.png" }
```

| Field | Type | Rules |
| ----- | ---- | ----- |
| `mime` | string | Required. Allowed: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `application/pdf`. Others → `400 VALIDATION`. |
| `size` | integer | Required, > 0. **Max 10 MB** (`10485760`); larger → `400 VALIDATION`. |
| `filename` | string | Optional. Only its extension is used to build the object key. |

- **200 response:**

```json
{
  "url": "https://nyc3.digitaloceanspaces.com/your-bucket/chat/<userId>/<uuid>.png?X-Amz-...",
  "key": "chat/<userId>/<uuid>.png",
  "expiresIn": 300
}
```

| Field | Meaning |
| ----- | ------- |
| `url` | Presigned **PUT** URL. `PUT` the raw bytes here within `expiresIn` seconds. Set the request `Content-Type` to the same `mime`. |
| `key` | The final object key. Use it as `attachment.key` in your `message:send`. |
| `expiresIn` | URL lifetime in seconds (**300**). |

- **Error cases:** uploads not configured on the server → `503 UNAVAILABLE`; bad mime/size →
  `400 VALIDATION`.

**Attachment upload flow:**
1. `POST /uploads/presign` → `{ url, key, expiresIn }`.
2. `PUT` the file bytes to `url` (direct to storage) with `Content-Type: <mime>`.
3. Build the **public** object URL for `attachment.url`. The presign response does not return
   the public URL directly; construct it from your storage's public/CDN base + `key` (confirm
   the exact base with the backend team — it depends on the Spaces/CDN config).
4. Send `message:send` (or REST send) with `type: "image" | "file"` and
   `attachments: [{ key, url, mime, size, width?, height? }]`.

### 5.7 `DELETE /conversations/:conversationId` — delete conversation (for me)

Hide a conversation from **your own** inbox. Per-participant: the other participant is unaffected
and still sees the thread and its full history. Your unread badge for it is reset to 0. A **new
message** in that conversation makes it reappear in your inbox automatically.

- **Auth:** required. Must be a participant, else `403 FORBIDDEN`.
- **Path param:** `conversationId` (24-hex).
- **Body:** none.
- **200 response:** `{ "ok": true }`.
- **Error cases:** not a participant → `403 FORBIDDEN`; unknown/invalid id → `404 NOT_FOUND`.
- **No socket event** is emitted — the effect is local to your inbox only.

### 5.8 `PATCH /conversations/:conversationId/mute` — mute / unmute

Toggle **push-notification** suppression for this conversation, for **you** only. Muting does
**not** stop unread counts or message delivery — it only suppresses the offline push.

- **Auth:** required. Must be a participant, else `403 FORBIDDEN`.
- **Path param:** `conversationId` (24-hex).
- **Request body:**

```json
{ "muted": true }
```

| Field | Type | Rules |
| ----- | ---- | ----- |
| `muted` | boolean | Required. `true` mutes, `false` unmutes. |

- **200 response:** `{ "ok": true, "muted": true }`.
- **Error cases:** not a participant → `403 FORBIDDEN`; unknown id → `404 NOT_FOUND`; missing/
  non-boolean `muted` → `400 VALIDATION`.

> The current mute state is also reflected on the conversation as `mutedBy: string[]` (the userIds
> who muted it) — see §4.

### 5.9 `DELETE /conversations/:conversationId/messages/:messageId` — unsend (delete for everyone)

Delete a message for **both** participants. **Sender-only** — only the message's author may
unsend it. The message is **tombstoned** (kept in history with `body:""`, `attachments:[]`,
`deletedAt` set) so ordering is preserved; render it as "message deleted".

- **Auth:** required. Must be a participant; must be the **sender** of the message.
- **Path params:** `conversationId`, `messageId` (both 24-hex).
- **Body:** none.
- **200 response:** `{ "ok": true, "messageId": "…" }`.
- **Side effect:** the server broadcasts **`message:deleted` `{ conversationId, messageId }`** to
  the conversation (§6.2), and recomputes `conversation.lastMessage` if the unsent message was the
  inbox preview.
- **Error cases:** not the sender → `403 FORBIDDEN`; unknown message / wrong conversation →
  `404 NOT_FOUND`. Idempotent: unsending an already-deleted message still returns `200`.

### 5.10 `POST /devices` — register a push token

Register (or refresh) this device's **Expo** push token so the user receives new-message
notifications while offline. Call on login / app start. Upserts by `token`: re-registering an
existing token reassigns it to the current user (correct for shared devices).

- **Auth:** required.
- **Request body:**

```json
{ "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", "platform": "android" }
```

| Field | Type | Rules |
| ----- | ---- | ----- |
| `token` | string | Required, non-empty. The device's `ExponentPushToken[...]`. |
| `platform` | `"ios"` \| `"android"` \| `"web"` | Required. |

- **201 response:** `{ "ok": true }`.
- **Error cases:** missing token / bad platform → `400 VALIDATION`.

### 5.11 `DELETE /devices` — unregister a push token

Drop this device's push token on logout. Scoped to the authenticated user (you cannot remove
another user's token).

- **Auth:** required.
- **Request body:** `{ "token": "ExponentPushToken[...]" }`.
- **200 response:** `{ "ok": true }`.
- **Error cases:** missing token → `400 VALIDATION`.

> See §10.5 for the full push behavior (when a push fires, payload shape, dead-token pruning).

### 5.12 Health endpoints (informational, no auth)

| Method | Path | Meaning |
| ------ | ---- | ------- |
| GET | `/healthz` | Liveness — `{ "status": "ok" }`. |
| GET | `/readyz` | Readiness — `200 {"status":"ready"}` or `503 {"status":"not-ready"}`. |
| GET | `/metrics` | Prometheus metrics (ops only). |

Unknown routes return `404` with `{ "error": { "code": "NOT_FOUND", "message": "Route not found" } }`.

---

## 6. Socket.IO event reference

Event names are exact and case-sensitive. **Acks** are Socket.IO acknowledgement callbacks:
you pass a function as the last argument to `emit`, and the server calls it with the result.

### 6.1 Client → Server

#### `message:send` — send a message (acked)

Primary send path. Same contract & effects as REST §5.5.

- **Payload:**

```json
{
  "conversationId": "64b2f0c2a1d4e5f600000abc",
  "clientMessageId": "9f1c0b3e-2c2a-4e7a-9b9a-1d2e3f4a5b6c",
  "type": "text",
  "body": "Hello!",
  "attachments": []
}
```

  Same field rules as REST send (§5.5): `clientMessageId` UUID v4; `type` enum; `body` 1–4000
  and required when `type === 'text'`; `attachments` optional.

- **Ack (success):** `{ "ok": true, "message": Message }`
- **Ack (failure):** `{ "ok": false, "error": { "code": "...", "message": "...", "details"?: {} } }`
- **Side effect:** the server emits **`message:new`** to all participants (including a
  `message:new` echo to the sender's own other devices). Reconcile by `clientMessageId`.

```js
socket.emit('message:send', payload, (ack) => {
  if (ack.ok) replaceOptimistic(ack.message);          // ack.message has real _id/createdAt
  else handleError(ack.error);                          // e.g. RATE_LIMITED, FORBIDDEN
});
```

#### `message:delivered` — report delivery (acked)

Tell the server you (the recipient device) received a message. **Relayed, not persisted** —
a transient hint to the sender.

- **Payload:** `{ "conversationId": "…", "messageId": "…" }` (both 24-hex)
- **Ack:** `{ "ok": true }` or `{ "ok": false, "error": {…} }`
- **Side effect:** server emits **`receipt:update`** with `deliveredMessageId` to the
  conversation.

#### `message:read` — mark read up to a point (acked)

Mark messages read; resets your unread counter and records your read watermark.

- **Payload:** `{ "conversationId": "…", "upToMessageId"?: "…" }`
  (`upToMessageId` optional 24-hex; omit to mark up to latest)
- **Ack:** `{ "ok": true }` or `{ "ok": false, "error": {…} }`
- **Side effect:** server persists `readState[you]` + zeroes `unreadCounts[you]`, then emits
  **`receipt:update`** with `lastReadMessageId` to the conversation.

#### `typing:start` / `typing:stop` — typing indicator (NO ack)

- **Payload:** `{ "conversationId": "…" }`
- **No ack.** Best-effort. Throttle ~2–3 s (see §3.4).
- **Side effect:** other participants receive **`typing`** with `isTyping: true|false`.

#### `conversation:sync` — catch up after reconnect (acked)

Ask for everything you missed across multiple conversations while disconnected.

- **Payload:** a map of `conversationId → newest message _id you currently hold`:

```json
{
  "cursors": {
    "64b2f0c2a1d4e5f600000abc": "64b2f0c2a1d4e5f600000f20",
    "64b2f0c2a1d4e5f600000def": "64b2f0c2a1d4e5f600000e10"
  }
}
```

- **Ack:** `{ "ok": true, "missed": Message[] }` — messages with `_id >` your cursor,
  **oldest-first**, across all requested conversations. Merge them into the right threads by
  `conversationId`.

#### `presence:heartbeat` — keep presence warm (NO ack)

- **Payload:** none. Emit periodically (e.g. every 30–60 s) on a live socket so the server
  refreshes your `lastSeenAt`.

> Note: `presence:heartbeat` is a literal event string and is **not** part of the shared
> `EVENTS` constant set (unlike the events above).

### 6.2 Server → Client

Register listeners for these as soon as you connect.

#### `message:new` — a new message arrived

```json
{ "message": { "_id": "…", "conversationId": "…", "senderId": "…", "clientMessageId": "…", "type": "text", "body": "Hi", "attachments": [], "status": "sent", "deletedAt": null, "createdAt": "2026-06-24T10:07:00.000Z" } }
```

Fires for messages from the other participant **and** as an echo of your own sends (covers
multi-device). Always dedupe/reconcile by `clientMessageId` (or `_id`).

#### `message:deleted` — a message was unsent (deleted for everyone)

```json
{ "conversationId": "…", "messageId": "…" }
```

Emitted to the conversation when a sender unsends a message (REST `DELETE …/messages/:messageId`,
§5.9). Find the message by `messageId` and render it as deleted (its `body` is now `""`,
`attachments` is `[]`, and `deletedAt` is set). The message keeps its position in history. If it
was the inbox preview, the server has already recomputed `conversation.lastMessage`.

#### `receipt:update` — delivery or read receipt

Two variants, distinguished by which id field is present:

```json
// delivered (transient)
{ "conversationId": "…", "userId": "<who delivered>", "deliveredMessageId": "…" }

// read
{ "conversationId": "…", "userId": "<who read>", "lastReadMessageId": "…" }
```

`userId` is the participant whose state changed. Use the **read** variant to drive "✓ Read".

#### `typing` — someone is typing

```json
{ "conversationId": "…", "userId": "<the typer>", "isTyping": true }
```

You only receive this for **other** participants (never your own typing).

#### `presence:update` — online/offline change

```json
// online
{ "userId": "…", "status": "online" }

// offline
{ "userId": "…", "status": "offline", "lastSeenAt": "2026-06-24T10:09:00.000Z" }
```

Emitted to the conversations you share with that user when they connect/disconnect.

---

## 7. End-to-end flows

### 7.1 Contact seller → open thread → load history

```
1. POST /conversations { itemId }            → { conversation }      (find-or-create)
2. (socket already connected; server auto-joined you to conv room)
3. GET  /conversations/:id                   → { conversation }      (live item overlay)
4. GET  /conversations/:id/messages?limit=50 → { messages } newest-first → reverse for display
5. On scroll-up: GET …/messages?before=<oldest _id held>&limit=50    (page back)
```

### 7.2 Sending (optimistic + reconcile)

```
1. id = uuidv4()
2. Render an optimistic bubble keyed by id (status: "sending")
3. socket.emit('message:send', { conversationId, clientMessageId: id, type:'text', body }, ack => {
     ok    → replace optimistic bubble with ack.message (real _id, createdAt; status "sent")
     !ok   → mark bubble "failed"; offer retry with the SAME id (idempotent)
   })
4. message:new for the same clientMessageId may also arrive (multi-device) — dedupe by it.
```

If the socket is down, do step 3 via `POST /conversations/:id/messages` with the same body.

### 7.3 Receiving

```
socket.on('message:new', ({ message }) => {
  if (knownByClientMessageId(message.clientMessageId)) reconcile(message);
  else appendToThread(message.conversationId, message);
  if (threadIsOpenAndFocused(message.conversationId))
     socket.emit('message:read', { conversationId: message.conversationId, upToMessageId: message._id });
  else
     socket.emit('message:delivered', { conversationId: message.conversationId, messageId: message._id });
});
```

### 7.4 Receipts & typing

```
- On opening/focusing a thread: emit message:read { conversationId, upToMessageId: latest _id }.
- Listen for receipt:update → update the other user's read/delivered markers.
- On text input change: throttled typing:start; on idle/blur/send: typing:stop.
- Listen for typing → show/hide the indicator; auto-hide after ~4s if no stop arrives.
```

### 7.5 Reconnect & catch-up

```
socket.on('connect', () => {
  const cursors = buildCursorsFromLocalState();   // { [conversationId]: newest _id held }
  socket.emit('conversation:sync', { cursors }, (ack) => {
    if (ack.ok) ack.missed.forEach(m => appendToThread(m.conversationId, m)); // oldest-first
  });
});
```

### 7.6 Presence

```
socket.on('presence:update', ({ userId, status, lastSeenAt }) => updatePresence(userId, status, lastSeenAt));
setInterval(() => socket.connected && socket.emit('presence:heartbeat'), 45000);
```

---

## 8. Error handling & reconnect strategy

### 8.1 Unified error shape

**Every** error — REST response body and socket ack `error` — has this shape:

```json
{ "error": { "code": "VALIDATION", "message": "Invalid request", "details": { "body": ["Text messages require a body"] } } }
```

(For socket acks the envelope is `{ ok: false, error: { code, message, details? } }` — the
`error` object is the same.) `details` is present mainly on validation errors and maps field →
messages.

| `code` | HTTP | When |
| ------ | ---- | ---- |
| `VALIDATION` | 400 | Bad/missing field, bad ObjectId/UUID, body too long, text with empty body, unsupported mime/oversized upload. |
| `UNAUTHENTICATED` | 401 | Missing/invalid token. |
| `FORBIDDEN` | 403 | Not a participant of the conversation; item unavailable on create. |
| `NOT_FOUND` | 404 | Unknown conversation/item/route. |
| `CONFLICT` | 409 | Duplicate-key collision. |
| `RATE_LIMITED` | 429 | Over a rate limit (see §3.5) — back off. |
| `UNAVAILABLE` | 503 | Dependency down (e.g. uploads not configured; readiness not-ready). |
| `INTERNAL` | 500 | Unexpected server error. |

**Handle by `code`, not by string-matching `message`** (messages may change).

### 8.2 Reconnect strategy

- The socket auto-reconnects (Socket.IO default). On each `connect`, run
  `conversation:sync` (§7.5) to backfill missed messages — do not assume the socket buffered
  anything while you were offline.
- On `connect_error`, inspect the error: an auth rejection means refresh/replace the token and
  reconnect; a transport error means retry with backoff.
- Keep your message store authoritative locally; the server is the source of truth for `_id`,
  ordering, and read/unread state, which you reconcile on sync.

---

## 9. Recommended RN client shape

Brief guidance, not prescriptive code (this doc is a contract spec). A clean layering:

- **`socket` singleton** — one `socket.io-client` instance for the whole app, created after
  login with `{ auth: { token }, transports: ['websocket'] }`. Centralize all `emit`/`on`
  wiring here; re-run `conversation:sync` on every `connect`. Tear down on logout.
- **`api` module** — a thin REST client (axios/`fetch`) that injects `Authorization: Bearer`
  from your auth store and normalizes errors to `{ code, message, details }`. One function per
  route in §5.
- **Conversations store** — keyed by `conversationId`; holds the `Conversation` (inbox snapshot
  + opened overlay), `unreadCounts`, `readState`, presence, and typing flags.
- **Messages store** — per-conversation list ordered by `_id`, plus a `clientMessageId →
  message` index for optimistic reconcile and dedupe of `message:new` echoes.
- **Outbox** — pending sends keyed by `clientMessageId` with status `sending|sent|failed`;
  retries reuse the same id (idempotent). Falls back to REST send when the socket is down.
- **IDs/UUIDs** — generate `clientMessageId` with `expo-crypto`'s `randomUUID()` or
  `react-native-uuid` (must be UUID **v4**).

> State-management library (Zustand / Redux / Context) is your choice — the contract above is
> agnostic to it.

---

## 10. Appendix: quick reference & config

### 10.1 REST routes

| Method | Path | Auth | Body / Query | Success |
| ------ | ---- | ---- | ------------ | ------- |
| GET | `/conversations` | ✅ | — | `200 { conversations }` |
| POST | `/conversations` | ✅ (10/60s) | `{ itemId }` | `201 { conversation }` |
| GET | `/conversations/:id` | ✅ | — | `200 { conversation + itemLive }` |
| DELETE | `/conversations/:id` | ✅ | — | `200 { ok }` — "delete for me" (hides from MY inbox; a new message resurfaces it) |
| PATCH | `/conversations/:id/mute` | ✅ | `{ muted: boolean }` | `200 { ok, muted }` — mutes/unmutes push for me |
| GET | `/conversations/:id/messages` | ✅ | `?before&limit(1-100,def 50)` | `200 { messages }` newest-first |
| POST | `/conversations/:id/messages` | ✅ (30/10s) | `{ clientMessageId, type, body?, attachments? }` | `201 { message }` |
| DELETE | `/conversations/:id/messages/:messageId` | ✅ | — | `200 { ok, messageId }` — unsend for everyone (sender-only) |
| POST | `/uploads/presign` | ✅ | `{ mime, size, filename? }` | `200 { url, key, expiresIn }` |
| POST | `/devices` | ✅ | `{ token, platform }` | `201 { ok }` — register Expo push token |
| DELETE | `/devices` | ✅ | `{ token }` | `200 { ok }` — unregister on logout |
| GET | `/healthz` `/readyz` `/metrics` | — | — | health/metrics |

### 10.2 Socket events

| Direction | Event | Payload | Ack |
| --------- | ----- | ------- | --- |
| C→S | `message:send` | `{ conversationId, clientMessageId, type, body?, attachments? }` | `{ ok, message }` / `{ ok:false, error }` |
| C→S | `message:delivered` | `{ conversationId, messageId }` | `{ ok }` |
| C→S | `message:read` | `{ conversationId, upToMessageId? }` | `{ ok }` |
| C→S | `typing:start` / `typing:stop` | `{ conversationId }` | none |
| C→S | `conversation:sync` | `{ cursors: { [convId]: msgId } }` | `{ ok, missed[] }` |
| C→S | `presence:heartbeat` | — | none |
| S→C | `message:new` | `{ message }` | — |
| S→C | `message:deleted` | `{ conversationId, messageId }` | — (an unsend — render the message as deleted) |
| S→C | `receipt:update` | `{ conversationId, userId, deliveredMessageId? , lastReadMessageId? }` | — |
| S→C | `typing` | `{ conversationId, userId, isTyping }` | — |
| S→C | `presence:update` | `{ userId, status, lastSeenAt? }` | — |

### 10.3 Validation quick rules

- `clientMessageId`: UUID **v4**. `*Id`: 24-hex ObjectId string.
- `body`: trimmed, **1–4000** chars; required & non-empty for `type === 'text'`.
- `type`: `text | image | file`. `limit`: int 1–100 (default 50).
- `attachment`: `{ key:str, url:URL, mime:str, size:int≥0, width?:int>0, height?:int>0 }`.
- `attachments`: **at most 5** per message; `image`/`file` messages require **≥1** attachment.
- Upload: mime ∈ {jpeg,png,webp,gif,pdf}; size ≤ 10 MB; presign URL TTL 300 s.
- `platform` (devices): `ios | android | web`. `token`: an `ExponentPushToken[...]`.

### 10.4 Server config knobs that affect the client

| Env var | Default | Client impact |
| ------- | ------- | ------------- |
| `PORT` | `3000` | Base URL / socket origin. |
| `CORS_ORIGINS` | `*` | Must include your web origin (RN native is unaffected; Expo web isn't). `credentials: true`. |
| `AUTH_MODE` | `dev` | `dev` → token = userId; `jwt` → token = signed JWT (same wiring). |
| `EXPO_ACCESS_TOKEN` | — | Server-side only; push works without it. No client impact. |

### 10.5 Push notifications, delete & mute (behavior)

**Push (Expo).** Register the device's Expo push token after login/app-start with
`POST /devices { token: "ExponentPushToken[...]", platform: "ios"|"android"|"web" }`, and
`DELETE /devices { token }` on logout. The server pushes a new-message notification to a
recipient **only when they have no active socket** (are offline) **and** have not muted the
conversation. Payload: `title` = sender's display name, `body` = the text (truncated) or
`📷 Photo` / `📎 File`, `data = { type, conversationId, messageId?, itemTitle? }` — use `data`
to deep-link into the conversation (and, via `conversation.itemId`, the ad). Tokens Expo reports
as `DeviceNotRegistered` are pruned server-side; re-register on each app start.

**Unsend (delete message for everyone).** `DELETE /conversations/:id/messages/:messageId`
(sender-only; 403 otherwise). The message is tombstoned — it stays in history with
`deletedAt` set and `body:""`/`attachments:[]` — and a `message:deleted { conversationId,
messageId }` event is broadcast to the room. Render tombstoned messages as "message deleted".

**Delete conversation (for me).** `DELETE /conversations/:id` hides the conversation from the
caller's inbox only (the other participant is unaffected) and resets the caller's unread badge.
A new message in that conversation makes it reappear. No socket event is emitted.

**Mute.** `PATCH /conversations/:id/mute { muted }` toggles push suppression for the caller.
Muting does **not** stop unread counts — only push. The `muted` state is per-participant.

### 10.6 Source-of-truth files (server)

| Contract | File |
| -------- | ---- |
| Event names | `src/realtime/events.js` |
| Limits / enums / rate limits | `src/config/constants.js` |
| Shared validators | `src/common/validation/index.js` |
| Error codes & shape | `src/common/errors/AppError.js` |
| Conversation routes/controller | `src/modules/conversations/conversation.{routes,controller}.js` |
| Message routes/controller | `src/modules/messages/message.{routes,controller}.js` |
| Socket handlers | `src/realtime/handlers/{message,typing,presence}.handler.js` |
| Connection lifecycle / rooms | `src/realtime/gateway.js`, `src/realtime/rooms.js` |
| Upload presign | `src/modules/uploads/upload.{routes,controller,service}.js` |
| Devices / push (Expo) | `src/modules/notifications/{device.routes,device.controller,device.repository,notification.service,push.provider}.js` |
| App wiring (mounts, error handler) | `src/loaders/express.js`, `src/loaders/socket.js` |
```
