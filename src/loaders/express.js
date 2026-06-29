/**
 * Layer: Loader.
 * Builds the Express app: global middleware (requestId, securityHeaders/helmet, cors,
 * json body parsing, pino-http logging, rate limiting), mounts each module's routes,
 * exposes /healthz (liveness) and /readyz (both DB connections reachable), and registers the
 * centralized error handler LAST. Receives the container so route factories get their services
 * injected. Must NOT hold business logic.
 */
import express from 'express';
import { requestId } from '../common/middleware/requestId.js';
import { securityHeaders, corsMiddleware } from '../common/middleware/securityHeaders.js';
import { httpLogger, logger } from '../common/logger.js';
import { metricsHandler } from '../common/metrics.js';
import { AppError, ErrorCodes } from '../common/errors/AppError.js';
import { databasesReady } from './db.js';
import { createConversationRoutes } from '../modules/conversations/conversation.routes.js';
import { createMessageRoutes } from '../modules/messages/message.routes.js';
import { createUploadRoutes } from '../modules/uploads/upload.routes.js';
import { createDeviceRoutes } from '../modules/notifications/device.routes.js';

export function createExpressApp(container) {
  const app = express();
  app.set('trust proxy', true); // behind Nginx — honor X-Forwarded-* for req.ip

  app.use(requestId());
  app.use(securityHeaders());
  app.use(corsMiddleware());
  app.use(express.json({ limit: '256kb' }));
  app.use(httpLogger());

  // Liveness — process is up. Must NOT depend on the DB.
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

  // Readiness — both Mongo connections (chat + gratis) reachable.
  app.get('/readyz', (_req, res) => {
    const ready = databasesReady();
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not-ready' });
  });

  app.get('/metrics', metricsHandler);

  // Module routes. Message routes nest under a conversation and need mergeParams.
  app.use('/conversations', createConversationRoutes(container));
  app.use('/conversations/:conversationId/messages', createMessageRoutes(container));
  app.use('/uploads', createUploadRoutes(container));
  app.use('/devices', createDeviceRoutes(container));

  // Unknown route → 404 in the standard error shape.
  app.use((_req, _res, next) => next(AppError.notFound('Route not found')));

  // Centralized error handler — MUST be last.

  app.use((err, req, res, _next) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: err.toJSON() });
      return;
    }
    // Mongo duplicate-key → 409 (e.g. the unique {itemId, participantIds} index).
    if (err?.code === 11000) {
      res.status(409).json({ error: { code: ErrorCodes.CONFLICT, message: 'Duplicate resource' } });
      return;
    }
    logger.error({ err, reqId: req.id }, 'unhandled error');
    res
      .status(500)
      .json({ error: { code: ErrorCodes.INTERNAL, message: 'Internal server error' } });
  });

  return app;
}

export default createExpressApp;
