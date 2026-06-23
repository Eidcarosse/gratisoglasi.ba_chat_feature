/**
 * Layer: Config.
 * Typed env loading + validation. Reads process.env (via dotenv), validates the full set
 * with zod, and exports a frozen `config` object. FAILS FAST on boot if any required var is
 * missing or malformed — nothing else in the app should read process.env directly.
 * Keys (see .env.example): MONGO_URI, JWT_*, SPACES_*, MESSAGE_STORE, PORT, CORS_ORIGINS,
 *                          REDIS_URL (later), PUSH_* (later).
 */
