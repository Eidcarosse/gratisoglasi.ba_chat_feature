/**
 * Layer: Service — the notify() seam.
 * notify(event) is the single entry point for out-of-band delivery (e.g. message to an offline
 * recipient). At MVP it runs INLINE and is mostly a no-op / log. LATER (doc §10): move the body
 * onto a queue + worker (jobs/) and fan out to push providers — callers (messageService) never change.
 * Looks up recipient devices via the device model/repo. Must NOT touch Mongoose directly.
 */
