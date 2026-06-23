/**
 * Layer: Transport (REST controller).
 * User HTTP endpoints (get my profile, get public profile, update profile): validate input,
 * call userService, shape the response — and never leak email/phone in public payloads.
 * Must NOT hold business logic or touch the DB.
 */
