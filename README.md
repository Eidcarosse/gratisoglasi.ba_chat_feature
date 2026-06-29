# Marketplace Chat — Backend

Realtime marketplace messaging backend, built as a **modular monolith** with hard internal
seams so it can scale out later without rewriting business logic.

**Stack:** Node.js · Express · Socket.io · MongoDB (Mongoose) · DigitalOcean (droplet · Managed
Mongo · Spaces) · Nginx · PM2.

## The one rule

**Nothing talks to the database directly.** All data access goes through **repository
interfaces**. Services depend on the *interface*, never a concrete store. One file —
`src/loaders/container.js` — decides which implementation is injected. That seam is what makes
the future ScyllaDB migration an additive change (new impl + flip `MESSAGE_STORE`), not a rewrite.

## Architecture at a glance

```
Transport (Express routes · Socket.io handlers)  → parse, authn/authz, validate, call a service
        │
Service  (modules/*/*.service.js)                → ALL business logic lives here
        │ via interfaces
Repository (modules/*/*.repository*.js)           → data access only — the swap seam
        │
Model / Store (Mongoose · Spaces · presence)      → schema + indexes; swappable backends
```

Layer boundaries are strict — see the header comment in every file and the table in the
architecture doc §3. Cross-module calls go **service → service**, never reaching into another
module's repository or model.

## Main-site integration (soft-shell)

The chat **does not own users or items** — those live in the existing main-site **`Gratis`**
MongoDB. This service owns only conversations, messages, and devices, and references main-site
data by `ObjectId`. Consequences baked into the design:

- **Two Mongo connections** (`src/loaders/db.js`): the default connection is the chat's own DB
  (`CHAT_MONGO_URI`, read-write); a second, read-only connection (`GRATIS_MONGO_URI`) reads the
  main `Gratis` DB. `.populate()` cannot cross connections — main-site data is resolved through
  `src/integrations/gratis/` (the only place the Gratis DB is touched; reads only).
- **Conversations carry a denormalized snapshot** (`item` + `participants`) taken at creation, so
  the inbox renders with zero cross-DB joins. Opening a conversation live-refreshes the item's
  price/status; the inbox keeps the snapshot.
- **Auth is a verifier seam** (`src/modules/auth/auth.verifier.*`), chosen by `AUTH_MODE`:
  `dev` trusts the claimed `userId` (mirrors the main site's current no-auth posture — spoofable,
  logged loudly on boot), `jwt` verifies a signed token later. The chat issues no tokens and has
  no register/login. **Membership (`userId ∈ participantIds`) is enforced on every op regardless
  of auth mode** — it's the real guard until JWT lands.

## Project layout

```
src/
├── config/        env loading + validation, constants/enums
├── loaders/       composition root — express · db (2 conns) · socket · container (DI)
├── integrations/
│   └── gratis/    READ-ONLY access to the main-site users + items (the only Gratis-DB touchpoint)
├── modules/       domain modules: auth (verifier seam) · conversations ·
│                  messages · presence · notifications · uploads
├── realtime/      thin Socket.io gateway — handlers delegate to services
├── common/        errors · middleware · validation (zod) · logger · metrics
├── jobs/          (LATER) queue workers: push, search-index, cleanup
├── app.js         build app (no listen) — testable
└── server.js      boot: run loaders, listen, graceful shutdown
```

## Getting started

```bash
cp .env.example .env     # fill in the keys below
npm install
npm run dev              # nodemon on src/
npm test                 # vitest + supertest + in-memory mongo (no Atlas needed)
```

### Environment

| Key | Required | Notes |
|---|---|---|
| `CHAT_MONGO_URI` | ✅ | Chat's own DB (read-write): conversations, messages, devices. |
| `GRATIS_MONGO_URI` | ✅ | Main `Gratis` DB (read-only — use a read-only Atlas DB user). |
| `AUTH_MODE` | — | `dev` (default, spoofable) or `jwt`. |
| `JWT_SECRET` | when `AUTH_MODE=jwt` | ≥16 chars; boot fails fast without it. |
| `MESSAGE_STORE` | — | `mongo` (default). `scylla` reserved for later. |
| `PORT` · `CORS_ORIGINS` | — | Server port; comma-separated CORS allowlist (`*` default). |
| `SPACES_ENDPOINT` · `SPACES_REGION` · `SPACES_BUCKET` · `SPACES_KEY` · `SPACES_SECRET` | for uploads | DO Spaces / S3 presign. The `/uploads/presign` route 503s if unset. |

> Locally you can point both URIs at one mongod with two DB names
> (`mongodb://localhost:27017/GratisChat` and `…/Gratis`) — that exercises the two-connection seam.

Identity for requests: `Authorization: Bearer <token>` (REST) and `socket.handshake.auth.token`
(ws). Under `AUTH_MODE=dev` the token is just the main-site `userId`.

Health checks: `GET /healthz` (liveness, no DB) · `GET /readyz` (BOTH Mongo connections reachable).

## Scaling seams (designed-for, not built now)

| Trigger | Add | Seam it slots into |
|---|---|---|
| Multi-process / 2nd droplet | Redis + `@socket.io/redis-adapter`; `presence.store.redis.js` | room-scoped emits + `IPresenceStore` already abstracted |
| High push volume / receipts | move `notify()` onto a queue worker; poll Expo receipts | Expo push via `push.provider.js` + `notify()` seam already send inline |
| High message volume (~1yr) | `message.repository.scylla.js`; dual-write → backfill → cutover | `IMessageRepository` already abstracts all message access |
| Realtime needs independent scaling | extract `realtime/` gateway into its own deployable | transport/service boundary already strict |

> **Status:** Implemented end-to-end (loaders, two-connection DB, gratis read-only integration,
> auth verifier seam, conversations with snapshots, messages + keyset history, realtime gateway,
> presence, typing, uploads, receipts, **unsend (delete-for-everyone), delete-conversation
> (hide-for-me), mute, Expo push notifications + device registration, and a 7-day TTL that
> auto-deletes conversations and their messages**) with integration tests (`npm test`).
> The ScyllaDB message repo and Redis presence store remain header-only placeholders behind their
> existing seams.
