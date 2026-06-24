/**
 * Layer: Integration (Gratis main-site — READ-ONLY service).
 * Translates raw main-site docs into the snapshots/summaries the chat needs, applying all the
 * defensive rules:
 *   - getItemSnapshot(itemId) → { itemId, title, thumbnailUrl: images[0], price (nullable),
 *                                 status, sellerId: addedBy, hidden }  (null if item missing)
 *   - getUserSummaries(ids)   → Map<userId, { displayName, avatarUrl }>
 * displayName is derived defensively (firstname+lastname → email local-part → "User"). The
 * email local-part fallback is ONLY used when showEmail !== false — when a user hides their
 * email we never surface any part of it, falling straight back to "User". Email is NEVER
 * included in any returned payload.
 */
export class GratisService {
  /** @param {import('./gratis.repository.js').GratisRepository} gratisRepository */
  constructor(gratisRepository) {
    this.repo = gratisRepository;
  }

  async getItemSnapshot(itemId) {
    const item = await this.repo.getItemById(itemId);
    if (!item) return null;
    return {
      itemId: String(item._id),
      title: item.title ?? '',
      thumbnailUrl: Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : null,
      price: item.price ?? null, // nullable — passes through
      status: item.status ?? null,
      sellerId: item.addedBy ? String(item.addedBy) : null,
      hidden: Boolean(item.hidden),
    };
  }

  /** @returns {Promise<Map<string, {displayName: string, avatarUrl: string|null}>>} */
  async getUserSummaries(ids) {
    const unique = [...new Set((ids || []).map(String))];
    const users = await this.repo.getUsersByIds(unique);
    const byId = new Map(users.map((u) => [String(u._id), u]));
    const out = new Map();
    for (const id of unique) {
      out.set(id, this.#summarize(byId.get(id)));
    }
    return out;
  }

  #summarize(user) {
    if (!user) return { displayName: 'User', avatarUrl: null };
    const displayName = this.#deriveDisplayName(user);
    return { displayName, avatarUrl: user.profilePicture ?? null };
  }

  #deriveDisplayName(user) {
    const full = [user.firstname, user.lastname]
      .filter((s) => s && String(s).trim())
      .join(' ')
      .trim();
    if (full) return full;
    // Email local-part fallback — privacy-gated: only when the user has not hidden their email.
    if (user.showEmail !== false && typeof user.email === 'string' && user.email.includes('@')) {
      const local = user.email.split('@')[0].trim();
      if (local) return local;
    }
    return 'User';
  }
}

export default GratisService;
