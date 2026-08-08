/**
 * Infrastructure: MongoDB transaction runner.
 * Keeps session lifecycle and retry behavior out of domain services. The callback must contain
 * database work only; callers perform realtime, push, and metric side effects after this method
 * resolves so MongoDB transaction retries cannot duplicate them.
 */
export class MongoTransactionRunner {
  /**
   * @param {import('mongoose').Connection} connection chat MongoDB connection
   */
  constructor(connection) {
    this.connection = connection;
  }

  async run(work) {
    const session = await this.connection.startSession();
    try {
      // withTransaction retries transient transaction errors and commit uncertainty according to
      // the MongoDB driver's transaction rules.
      return await session.withTransaction(() => work(session));
    } finally {
      await session.endSession();
    }
  }
}

export default MongoTransactionRunner;
