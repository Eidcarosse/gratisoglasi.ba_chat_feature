/**
 * Layer: Model (Mongoose schema).
 * messages collection — ONE document per message, Scylla-ready access pattern (doc §4):
 *   { _id (ObjectId, time-sortable — doubles as ordering/seq key), conversationId (= future
 *     Scylla PARTITION KEY), senderId, clientMessageId (client UUID for idempotent dedup),
 *     type: 'text'|'image'|'file', body, attachments: [{key,url,mime,size,width,height}],
 *     status: 'sent', createdAt }
 * delivered/read are tracked on conversation.readState, NOT per message doc.
 * Indexes:
 *   { conversationId: 1, _id: -1 }                    → history (keyset pagination)
 *   { conversationId: 1, clientMessageId: 1 } unique  → dedup / idempotency
 * Schema + indexes only; no cross-entity logic.
 */
