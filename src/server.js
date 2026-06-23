/**
 * Layer: Entry (boot).
 * Process entrypoint: runs the loaders, starts the HTTP + Socket.io server listening on
 * config.PORT, and installs graceful-shutdown handlers (SIGTERM/SIGINT): stop accepting
 * connections → drain in-flight events → close Socket.io → close Mongo → exit. Clients
 * auto-reconnect. Also wires uncaught-exception / unhandled-rejection logging.
 */
