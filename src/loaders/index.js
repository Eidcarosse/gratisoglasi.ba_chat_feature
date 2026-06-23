/**
 * Layer: Loader (composition root entry).
 * Orchestrates the boot loaders IN ORDER: config → mongoose (connect + index sync) →
 * container (build repos + services, inject impls) → express (app, middleware, routes) →
 * socket (Socket.io server, auth middleware, register gateway). Returns the assembled
 * { app, httpServer, io, container } to server.js.
 * Must NOT hold business logic — wiring only.
 */
