/**
 * Layer: Entry (composition).
 * Builds and returns the Express app WITHOUT calling listen() — keeps the app importable in
 * tests (supertest) and decoupled from the network. Delegates wiring to loaders/express.js.
 * Booting/listening is server.js's job.
 */
