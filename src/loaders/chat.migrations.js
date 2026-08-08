/**
 * Layer: Loader — idempotent data migrations that must finish before the app accepts traffic.
 *
 * Retention used to store one fixed seven-day deadline on every message and conversation. The
 * current policy expires each message relative to its own creation time and keeps a conversation
 * until its newest message expires. Recomputing the absolute dates on every boot is intentional:
 * it is safe to rerun and avoids a one-time marker leaving a partially migrated dataset.
 */
import { logger } from '../common/logger.js';
import { LIMITS } from '../config/constants.js';
import { ConversationModel } from '../modules/conversations/conversation.model.js';
import { MessageModel } from '../modules/messages/message.model.js';

const CHAT_TTL_MS = LIMITS.CHAT_TTL_DAYS * 24 * 60 * 60 * 1000;

export async function migrateChatRetention() {
  const expectedMessageExpiry = { $add: ['$createdAt', CHAT_TTL_MS] };
  const messageResult = await MessageModel.collection.updateMany(
    {
      $expr: {
        $ne: [{ $ifNull: ['$expiresAt', null] }, expectedMessageExpiry],
      },
    },
    [{ $set: { expiresAt: expectedMessageExpiry } }],
  );

  // Project only _id + expiresAt into $merge so no conversation snapshot fields are rewritten.
  // The existing { conversationId, _id } message index makes the newest-message lookup bounded.
  await ConversationModel.collection
    .aggregate(
      [
        {
          $lookup: {
            from: MessageModel.collection.name,
            let: { conversationId: '$_id' },
            pipeline: [
              { $match: { $expr: { $eq: ['$conversationId', '$$conversationId'] } } },
              { $sort: { _id: -1 } },
              { $limit: 1 },
              { $project: { _id: 0, expiresAt: 1 } },
            ],
            as: 'retentionNewest',
          },
        },
        {
          $set: {
            retentionTarget: {
              $ifNull: [
                { $arrayElemAt: ['$retentionNewest.expiresAt', 0] },
                { $add: ['$createdAt', CHAT_TTL_MS] },
              ],
            },
          },
        },
        {
          $match: {
            $expr: {
              $ne: [{ $ifNull: ['$expiresAt', null] }, '$retentionTarget'],
            },
          },
        },
        { $project: { _id: 1, expiresAt: '$retentionTarget' } },
        {
          $merge: {
            into: ConversationModel.collection.name,
            on: '_id',
            whenMatched: 'merge',
            whenNotMatched: 'discard',
          },
        },
      ],
      { allowDiskUse: true },
    )
    .toArray();

  logger.info(
    { messagesUpdated: messageResult.modifiedCount },
    'chat retention migration complete',
  );
}

export default migrateChatRetention;
