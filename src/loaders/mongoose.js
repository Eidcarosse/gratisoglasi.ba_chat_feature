/**
 * Layer: Loader.
 * Establishes the MongoDB connection via Mongoose using config.MONGO_URI, sets connection
 * options, wires connection event logging, and triggers index sync so the indexes declared
 * in each model (doc §4) are built. Exposes connection state for the /readyz health check.
 * Must NOT hold business logic.
 */
