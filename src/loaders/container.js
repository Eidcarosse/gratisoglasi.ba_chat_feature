/**
 * Layer: Loader — THE dependency-injection composition root (the swap seam).
 * The single place that decides which concrete implementations back each interface, then
 * constructs every repository and service with its dependencies injected. Services depend on
 * INTERFACES, never concrete classes — so swapping a backend touches only this file.
 *
 * Key decisions made here:
 *   - messageRepository: config.MESSAGE_STORE === 'scylla'
 *       ? new ScyllaMessageRepository(scyllaClient)   // LATER (doc §5)
 *       : new MongoMessageRepository();               // TODAY
 *   - presenceStore: Redis impl later vs in-memory Map today (IPresenceStore).
 *
 * Returns a container exposing built services (auth, user, listing, conversation, message,
 * presence, notification, upload) for transports/gateway to consume.
 * Must NOT hold business logic — wiring only.
 */
