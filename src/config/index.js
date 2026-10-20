/**
 * Layer: Config.
 * Typed env loading + validation. Reads process.env (via dotenv), validates the full set
 * with zod, and exports a frozen `config` object. FAILS FAST on boot if any required var is
 * missing or malformed — nothing else in the app should read process.env directly.
 *
 * Shared-database topology: the chat service uses the SAME MongoDB as the Fastify BE and the legacy
 * main BE (MONGO_URI) — users, ads and bids are read from it, chat_rooms / messages / blocks / devices
 * are shared with Fastify. Fastify's scripts/indexes.ts owns every index. Auth is a verifier seam selected by
 * AUTH_MODE (dev-trust today, jwt later). There is NO chat-side login, so no registration
 * JWT secrets live here.
 */
import 'dotenv/config';
import { z } from 'zod';
import { logger } from '../common/logger.js';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    // The one shared database (same URI as the Fastify BE and the legacy main BE).
    MONGO_URI: z.string().min(1, 'MONGO_URI is required'),

    // Chat retention in days: each message expires this long after it is sent, a room lives until its
    // newest message expires. 0 disables expiry. Must equal the Fastify BE's CHAT_TTL_DAYS.
    CHAT_TTL_DAYS: z.coerce.number().int().min(0).default(30),

    // Cloudflare Images delivery hash + variant: ids stored in the shared DB become URLs here. The hash must
    // equal the one the Fastify BE and the legacy main BE use (the imagedelivery.net account hash).
    CF_IMAGES_ACCOUNT_HASH: z.string().default('sVauOVD8CVXGq0TdeFsc0A'),

    // Auth verifier seam.
    AUTH_MODE: z.enum(['dev', 'jwt']).default('dev'),
    JWT_SECRET: z.string().optional(),

    // Message store seam (mongo today, scylla later).
    MESSAGE_STORE: z.enum(['mongo', 'scylla']).default('mongo'),

    // CORS allowlist — comma-separated origins.
    CORS_ORIGINS: z
      .string()
      .default('*')
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      ),

    // Cloudflare Images (uploads). Optional — the /uploads/direct-upload route 503s if unset. The
    // runtime "enabled" gate is Boolean(CLOUDFLARE_ACCOUNT_ID && CLOUDFLARE_IMAGES_TOKEN).
    CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
    CLOUDFLARE_IMAGES_TOKEN: z.string().optional(),
    CLOUDFLARE_IMAGES_VARIANT: z.string().default('public'),

    // Expo Push (notifications). Optional — Expo accepts unauthenticated sends; an access token
    // only raises rate limits / enables FCM-v1 receipts. Push works without it.
    EXPO_ACCESS_TOKEN: z.string().optional(),
    // Android notification channel id — must match setNotificationChannelAsync on the client
    // (docs recommend 'default' with HIGH importance). Only sent for android-registered devices.
    EXPO_ANDROID_CHANNEL_ID: z.string().default('default'),
  })
  .superRefine((env, ctx) => {
    // JWT mode is useless without a secret — fail fast rather than verifying against undefined.
    if (env.AUTH_MODE === 'jwt' && (!env.JWT_SECRET || env.JWT_SECRET.length < 16)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET (>=16 chars) is required when AUTH_MODE=jwt',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  logger.fatal(
    { issues: parsed.error.flatten().fieldErrors },
    'Invalid environment configuration — refusing to boot',
  );

  process.exit(1);
}

export const config = Object.freeze(parsed.data);

// Loud, deliberate warning: dev-trust identity is spoofable. Per the soft-shell plan it must
// not be exposed in production until the main site issues JWTs and AUTH_MODE=jwt is set.
if (config.AUTH_MODE === 'dev') {
  const banner =
    'AUTH_MODE=dev — identity is TRUSTED FROM THE REQUEST WITHOUT VERIFICATION (spoofable). ' +
    'Do NOT expose this to untrusted clients. Switch to AUTH_MODE=jwt before production.';
  if (config.NODE_ENV === 'production') {
    logger.warn({ authMode: 'dev', nodeEnv: 'production' }, `⚠️  ${banner}`);
  } else {
    logger.warn({ authMode: 'dev' }, banner);
  }
}

export default config;
