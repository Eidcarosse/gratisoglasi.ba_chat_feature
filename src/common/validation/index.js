/**
 * Layer: Common (validation).
 * Shared zod helpers and reusable primitives (objectId, pagination cursor, message-type enum,
 * length limits) used to compose per-endpoint and per-event schemas. Module-specific schemas
 * live beside their module; this file holds only the cross-cutting building blocks.
 */
import { z } from 'zod';
import mongoose from 'mongoose';
import { MESSAGE_TYPES, LIMITS } from '../../config/constants.js';

/**
 * objectId — accepts a 24-hex string OR an ObjectId, validates it, and TRANSFORMS to a real
 * mongoose ObjectId. Storing real ObjectIds (never strings) is what lets the cross-DB refs and
 * the unique {itemId, participantIds} index dedup correctly (see plan Seam 1).
 */
export const objectId = z
  .union([z.string(), z.instanceof(mongoose.Types.ObjectId)])
  .refine((v) => mongoose.Types.ObjectId.isValid(v), { message: 'Invalid ObjectId' })
  .transform((v) => new mongoose.Types.ObjectId(v));

/** objectIdString — same validation, but keeps the canonical 24-hex string form. */
export const objectIdString = z
  .union([z.string(), z.instanceof(mongoose.Types.ObjectId)])
  .refine((v) => mongoose.Types.ObjectId.isValid(v), { message: 'Invalid ObjectId' })
  .transform((v) => String(v));

/** Keyset pagination params for message history (cursor = a message _id, newest-first). */
export const pagination = z.object({
  before: objectId.optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(LIMITS.MAX_PAGE_SIZE)
    .default(LIMITS.DEFAULT_PAGE_SIZE),
});

export const messageType = z.enum(MESSAGE_TYPES);

export const messageBody = z.string().trim().min(1).max(LIMITS.MAX_MESSAGE_LENGTH);

export const clientMessageId = z.string().uuid();

export const attachment = z.object({
  key: z.string().min(1),
  url: z.string().url(),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export { z };
