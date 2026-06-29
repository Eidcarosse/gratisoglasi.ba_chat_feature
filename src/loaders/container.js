/**
 * Layer: Loader — THE dependency-injection composition root (the swap seam).
 * The single place that decides which concrete implementations back each interface, then
 * constructs every repository and service with its dependencies injected. Services depend on
 * INTERFACES, never concrete classes — so swapping a backend touches only this file.
 *
 * Key decisions made here:
 *   - authVerifier:     config.AUTH_MODE === 'jwt' ? JwtVerifier : DevVerifier
 *   - messageRepository config.MESSAGE_STORE === 'scylla' ? Scylla (LATER) : MongoMessageRepository
 *   - presenceStore:    Redis impl later vs in-memory Map today (IPresenceStore)
 *
 * Build ORDER matters (plan Seam 5): gratisRepository → gratisService → conversationService,
 * because conversationService depends on gratisService to resolve main-site items/users.
 * Returns a container exposing built services + the auth guards for transports/gateway.
 * Must NOT hold business logic — wiring only.
 */
import { config } from '../config/index.js';
import { logger } from '../common/logger.js';
import { rateLimit } from '../common/middleware/rateLimit.js';
import { RATE_LIMITS } from '../config/constants.js';

import { DevVerifier } from '../modules/auth/auth.verifier.dev.js';
import { JwtVerifier } from '../modules/auth/auth.verifier.jwt.js';
import { createAuthMiddleware } from '../modules/auth/auth.middleware.js';

import { GratisRepository } from '../integrations/gratis/gratis.repository.js';
import { GratisService } from '../integrations/gratis/gratis.service.js';

import { ConversationRepository } from '../modules/conversations/conversation.repository.js';
import { ConversationService } from '../modules/conversations/conversation.service.js';
import { ConversationModel } from '../modules/conversations/conversation.model.js';

import { MongoMessageRepository } from '../modules/messages/message.repository.mongo.js';
import { MessageService } from '../modules/messages/message.service.js';
import { MessageModel } from '../modules/messages/message.model.js';

import { MemoryPresenceStore } from '../modules/presence/presence.store.memory.js';
import { PresenceService } from '../modules/presence/presence.service.js';

import { NotificationService } from '../modules/notifications/notification.service.js';
import { DeviceRepository } from '../modules/notifications/device.repository.js';
import { ExpoPushProvider } from '../modules/notifications/push.provider.js';
import { DeviceModel } from '../modules/notifications/device.model.js';

import { UploadService } from '../modules/uploads/upload.service.js';

import { Gateway } from '../realtime/gateway.js';

export function buildContainer({ gratisConn }) {
  // --- Auth verifier seam ---
  const authVerifier =
    config.AUTH_MODE === 'jwt' ? new JwtVerifier(config.JWT_SECRET) : new DevVerifier();
  const { requireAuth, socketAuth } = createAuthMiddleware(authVerifier);

  // Dedicated anti-scam limiter for new-conversation creation (plan Seam 7).
  const newConversationLimiter = rateLimit({
    ...RATE_LIMITS.NEW_CONVERSATION,
    keyPrefix: 'newconv',
  });

  // --- Gratis read-only chain (built BEFORE conversationService) ---
  const gratisRepository = new GratisRepository(gratisConn);
  const gratisService = new GratisService(gratisRepository);

  // --- Conversations ---
  const conversationRepository = new ConversationRepository();
  const conversationService = new ConversationService({ conversationRepository, gratisService });

  // --- Message store seam ---
  let messageRepository;
  if (config.MESSAGE_STORE === 'scylla') {
    throw new Error(
      'MESSAGE_STORE=scylla is not implemented yet — see message.repository.scylla.js',
    );
  } else {
    messageRepository = new MongoMessageRepository();
  }

  // --- Presence (memory store today) ---
  const presenceStore = new MemoryPresenceStore();
  const presenceService = new PresenceService({ presenceStore });

  // --- Notifications (Expo push) + realtime emitter ---
  const deviceRepository = new DeviceRepository();
  const pushProvider = new ExpoPushProvider({ accessToken: config.EXPO_ACCESS_TOKEN });
  const notificationService = new NotificationService({ deviceRepository, pushProvider });
  const gateway = new Gateway();

  // --- Messages (single write path) ---
  const messageService = new MessageService({
    messageRepository,
    conversationService,
    gateway,
    notificationService,
    presenceService,
  });

  // --- Uploads ---
  const uploadService = new UploadService();

  logger.info(
    { authMode: config.AUTH_MODE, messageStore: config.MESSAGE_STORE },
    'container built',
  );

  return {
    // auth guards
    authVerifier,
    requireAuth,
    socketAuth,
    newConversationLimiter,
    // services
    gratisService,
    conversationService,
    messageService,
    presenceService,
    notificationService,
    deviceRepository,
    pushProvider,
    uploadService,
    gateway,
    // models (for index sync)
    models: [ConversationModel, MessageModel, DeviceModel],
  };
}

/** Build the indexes declared on the chat-DB models. Awaited at boot and in tests. */
export async function syncChatIndexes(container) {
  await Promise.all(container.models.map((m) => m.syncIndexes()));
}

export default buildContainer;
