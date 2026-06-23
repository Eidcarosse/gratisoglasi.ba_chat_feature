/**
 * Layer: Model (Mongoose schema).
 * listings collection (doc §4): { sellerId (ref users), title, price, currency,
 * status: 'active'|'sold'|'closed', thumbnailUrl, createdAt, updatedAt }.
 * A conversation is scoped to exactly one listing.
 * Indexes: { sellerId: 1, status: 1 }, { status: 1, createdAt: -1 }.
 * Schema + indexes only; no cross-entity logic.
 */
