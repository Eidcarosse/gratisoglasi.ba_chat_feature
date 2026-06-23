/**
 * Layer: Transport (socket handler — thin).
 * Registers typing:start / typing:stop (doc §7). Ephemeral, NEVER persisted: verify the sender
 * is a participant, then relay a `typing` event to the OTHER participant only (conv room minus
 * sender). Client throttles emits (~2–3s) and auto-expires if a stop is lost.
 * Must NOT hold business logic.
 */
