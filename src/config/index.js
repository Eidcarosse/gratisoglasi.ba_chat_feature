/**
 * Layer: Config.
 * Typed env loading + validation. Reads process.env (via dotenv), validates the full set
 * with zod, and exports a frozen `config` object. FAILS FAST on boot if any required var is
 * missing or malformed — nothing else in the app should read process.env directly.
 *
 * Soft-shell topology (see plan): the chat owns its own DB (CHAT_MONGO_URI) and reads the
 * main-site Gratis DB read-only (GRATIS_MONGO_URI). Auth is a verifier seam selected by
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

    // Two-connection topology.
    CHAT_MONGO_URI: z.string().min(1, 'CHAT_MONGO_URI is required'),
    GRATIS_MONGO_URI: z.string().min(1, 'GRATIS_MONGO_URI is required'),

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

    // DigitalOcean Spaces / S3 (uploads). Optional at MVP — presign route 503s if unset.
    SPACES_ENDPOINT: z.string().optional(),
    SPACES_REGION: z.string().default('us-east-1'),
    SPACES_BUCKET: z.string().optional(),
    SPACES_KEY: z.string().optional(),
    SPACES_SECRET: z.string().optional(),

    // Expo Push (notifications). Optional — Expo accepts unauthenticated sends; an access token
    // only raises rate limits / enables FCM-v1 receipts. Push works without it.
    EXPO_ACCESS_TOKEN: z.string().optional(),
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
