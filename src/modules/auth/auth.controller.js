/**
 * Layer: Transport (REST controller).
 * Handles auth HTTP endpoints (register, login, refresh, logout): parse + validate input,
 * call authService, shape the response (set/clear refresh cookie, return access token).
 * Must NOT hold business logic or touch the DB.
 */
