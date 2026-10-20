/**
 * Layer: Mapper (shared-DB message <-> the legacy message shape clients still read).
 * The shared `messages` row stores the text RAW. Old apps always received it HTML-escaped (angle brackets
 * only), in REST history, socket payloads and push bodies alike, so the escape is applied here, on the way
 * out of the repository — everything downstream sees exactly what it saw before. Pure functions, no I/O.
 */
import { imageUrl } from '../../common/media.js';

export function escapeBody(body) {
  return typeof body === 'string' ? body.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
}

export function unescapeBody(body) {
  return typeof body === 'string' ? body.replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '';
}

/** Shared attachment `{ id, width, height }` -> legacy `{ key, url, mime, size, width, height }`. */
export function toLegacyAttachment(a) {
  return {
    key: a.id,
    url: imageUrl(a.id),
    mime: 'image/jpeg',
    size: null,
    width: a.width ?? undefined,
    height: a.height ?? undefined,
  };
}

/** Legacy send input attachments (`key` is the Cloudflare image id) -> shared `{ id, width, height }`. */
export function toSharedAttachments(attachments = []) {
  return attachments.map((a) => ({ id: a.key, width: a.width ?? null, height: a.height ?? null }));
}

/** A shared message document (lean or hydrated object) -> the legacy message. */
export function toLegacyMessage(m) {
  const type = m.deletedAt ? 'text' : m.type === 'system' ? 'text' : m.type;
  return {
    _id: m._id,
    conversationId: m.roomId,
    senderId: m.senderId,
    clientMessageId: m.clientMessageId,
    type,
    body: m.deletedAt ? '' : escapeBody(m.text ?? ''),
    attachments: (m.attachments || []).map(toLegacyAttachment),
    status: 'sent',
    deletedAt: m.deletedAt ?? null,
    createdAt: m.createdAt,
    expiresAt: m.expiresAt ?? undefined,
  };
}
