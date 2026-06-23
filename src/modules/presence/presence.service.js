/**
 * Layer: Service.
 * Presence business logic (doc §7): on connect mark online (ref-counted), on heartbeat refresh
 * lastSeenAt, on disconnect decrement and mark offline when no sockets remain. Emits
 * presence:update ONLY to counterparties in active conversations — never broadcast to everyone.
 * Depends on IPresenceStore (injected) — works identically over the memory or Redis impl.
 * Must NOT touch any store driver directly.
 */
