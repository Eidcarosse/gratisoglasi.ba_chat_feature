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

## Project layout

```
src/
├── config/        env loading + validation, constants/enums
├── loaders/       composition root — express · mongoose · socket · container (DI)
├── modules/       domain modules: auth · users · listings · conversations ·
│                  messages · presence · notifications · uploads
├── realtime/      thin Socket.io gateway — handlers delegate to services
├── common/        errors · middleware · validation (zod) · logger · metrics
├── jobs/          (LATER) queue workers: push, search-index, cleanup
├── app.js         build app (no listen) — testable
└── server.js      boot: run loaders, listen, graceful shutdown
```

## Getting started

```bash
cp .env.example .env     # fill in MONGO_URI, JWT secrets, SPACES_* …
npm install
npm run dev              # nodemon on src/
```

Health checks: `GET /healthz` (liveness) · `GET /readyz` (Mongo reachable).

## Scaling seams (designed-for, not built now)

| Trigger | Add | Seam it slots into |
|---|---|---|
| Multi-process / 2nd droplet | Redis + `@socket.io/redis-adapter`; `presence.store.redis.js` | room-scoped emits + `IPresenceStore` already abstracted |
| Offline users miss messages | FCM/APNs via `push.provider.js`; `notify()` → queue worker | `devices` model + `notify()` seam exist |
| High message volume (~1yr) | `message.repository.scylla.js`; dual-write → backfill → cutover | `IMessageRepository` already abstracts all message access |
| Realtime needs independent scaling | extract `realtime/` gateway into its own deployable | transport/service boundary already strict |

> **Status:** project scaffold — directory structure and file headers in place. Implementation
> follows the build order in the architecture doc §11, starting with the loaders + `/healthz`.
