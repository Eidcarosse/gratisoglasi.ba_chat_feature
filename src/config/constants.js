/**
 * Layer: Config.
 * Shared enums and limits — the single source of truth referenced across modules. No logic.
 */

export const MESSAGE_TYPE = Object.freeze({
  TEXT: 'text',
  IMAGE: 'image',
  FILE: 'file',
});
export const MESSAGE_TYPES = Object.freeze(Object.values(MESSAGE_TYPE));

// Messages carry a single 'sent' status; delivered/read live on conversation.readState.
export const MESSAGE_STATUS = Object.freeze({ SENT: 'sent' });

// Main-site `items.status` moderation enum (read-only; we store it verbatim — NOT 'sold').
export const ITEM_STATUS = Object.freeze(['Pending', 'Review', 'Approved']);

export const DEVICE_PLATFORM = Object.freeze(['ios', 'android', 'web']);

// Single TCP connection — removes the sticky-session requirement before going multi-node.
export const SOCKET_TRANSPORTS = Object.freeze(['websocket']);

export const AUTH_MODE = Object.freeze({ DEV: 'dev', JWT: 'jwt' });

export const MESSAGE_STORE = Object.freeze({ MONGO: 'mongo', SCYLLA: 'scylla' });

export const LIMITS = Object.freeze({
  MAX_MESSAGE_LENGTH: 4000,
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 100,
  // At most 5 attachments (images/files) per message. Enforced in the send schemas (REST + ws).
  MAX_ATTACHMENTS: 5,
  // At most this many conversations per conversation:sync request — caps the fan-out of DB
  // queries a single reconnect can trigger.
  MAX_SYNC_CONVERSATIONS: 50,
  // Each message auto-deletes this many days after it was sent. A conversation's expiry follows
  // its newest message, so the conversation remains available while it has any unexpired message.
  CHAT_TTL_DAYS: 30,
});

// Rate-limit windows/caps (in-memory now → Redis later). New-conversation creation is throttled
// harder than message send because marketplaces attract scam mass-DMing (one new convo/victim).
export const RATE_LIMITS = Object.freeze({
  MESSAGE_SEND: { windowMs: 10_000, max: 30 },
  NEW_CONVERSATION: { windowMs: 60_000, max: 10 },
  // Image upload only mints one-time Cloudflare direct-upload URLs (no bytes touch us); the cap
  // just blunts abuse of the Cloudflare API / URL minting. Each request mints up to MAX_ATTACHMENTS.
  IMAGE_UPLOAD: { windowMs: 60_000, max: 20 },
  DEFAULT: { windowMs: 60_000, max: 300 },
});
