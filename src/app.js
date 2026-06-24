/**
 * Layer: Entry (composition).
 * Builds and returns the Express app WITHOUT calling listen() — keeps the app importable in
 * tests (supertest) and decoupled from the network. Delegates wiring to loaders/express.js.
 * Booting/listening is server.js's job.
 *
 * `container` is built by loaders/container.js from the two DB connections. Tests construct
 * their own container (against mongodb-memory-server) and pass it here for full control over
 * the seeded gratis dataset.
 */
import { createExpressApp } from './loaders/express.js';

export function buildApp(container) {
  return createExpressApp(container);
}

export default buildApp;
