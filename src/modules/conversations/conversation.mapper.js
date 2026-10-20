/**
 * Layer: Mapper (shared `chat_rooms` row -> the legacy conversation shape clients still read).
 * The shared room has explicit buyer / seller fields; the legacy conversation had per-user maps. This
 * rebuilds those maps (and the ad snapshot) so REST responses, socket payloads and the service layer see
 * the same object as before. Users and the live ad status are resolved in batches by the caller and passed
 * in — the mapper itself is pure.
 */
import { imageUrl } from '../../common/media.js';
import { escapeBody } from '../messages/message.mapper.js';

const idOf = (v) => String(v);

function legacyLastMessage(room) {
  const last = room.lastMessage;
  if (!last) return null;
  const tombstone = last.type === 'system';
  return {
    messageId: last.messageId,
    body: tombstone ? '' : last.type === 'text' ? escapeBody(last.text) : `[${last.type}]`,
    senderId: last.senderId,
    type: tombstone ? 'text' : last.type,
    createdAt: last.at,
    // An unsent message previews as a tombstone; the shared preview has no deletedAt, so its time stands in.
    deletedAt: tombstone ? last.at : null,
  };
}

/**
 * @param {object} room  shared chat room (lean)
 * @param {{ summaries?: Map<string, {displayName: string, avatarUrl: string|null}>, status?: string|null }} [ctx]
 */
export function toLegacyConversation(room, { summaries, status = null } = {}) {
  const buyer = idOf(room.buyerId);
  const seller = idOf(room.sellerId);

  const readState = {};
  const clearedAt = {};
  for (const [id, lastRead, cleared] of [
    [buyer, room.buyerLastRead, room.buyerClearedTo],
    [seller, room.sellerLastRead, room.sellerClearedTo],
  ]) {
    if (lastRead) readState[id] = { lastReadMessageId: lastRead.messageId, lastReadAt: lastRead.at };
    if (cleared) clearedAt[id] = cleared.messageId;
  }

  const participants = {};
  if (summaries) {
    for (const id of [buyer, seller]) participants[id] = summaries.get(id) || { displayName: 'User', avatarUrl: null };
  }

  return {
    _id: room._id,
    itemId: room.adId,
    pairKey: `${buyer}:${seller}`,
    participantIds: [room.buyerId, room.sellerId],
    item: {
      title: room.adTitle,
      thumbnailUrl: room.adImageId ? imageUrl(room.adImageId) : null,
      price: room.adPriceMinor == null ? null : room.adPriceMinor / 100,
      status,
      sellerId: room.sellerId,
    },
    participants,
    lastMessage: legacyLastMessage(room),
    unreadCounts: { [buyer]: room.buyerUnreadCount || 0, [seller]: room.sellerUnreadCount || 0 },
    readState,
    deletedFor: [room.buyerArchivedAt ? room.buyerId : null, room.sellerArchivedAt ? room.sellerId : null].filter(Boolean),
    clearedAt,
    mutedBy: [room.buyerMutedAt ? room.buyerId : null, room.sellerMutedAt ? room.sellerId : null].filter(Boolean),
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    expiresAt: room.expiresAt ?? undefined,
  };
}
