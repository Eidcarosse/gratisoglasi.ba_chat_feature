/**
 * Layer: Integration (Gratis main-site data — READ-ONLY service).
 * Translates raw shared-DB documents into the snapshots / summaries the chat needs, applying all the
 * defensive rules:
 *   - getItemSnapshot(itemId) → { itemId, title, thumbnailUrl, imageId, price (nullable), priceMinor, status,
 *                                 sellerId, hidden }  (null if the ad is missing OR soft-deleted)
 *   - getUserSummaries(ids)   → Map<userId, { displayName, avatarUrl }>
 *   - getItemStatuses(ids)    → Map<adId, 'Approved'|'Pending'|'Review'|null>
 * displayName is derived defensively (firstname+lastname → email local-part → "User"). The email local-part
 * fallback is ONLY used when the user has not hidden their email (privacy.showEmail !== false). Email is NEVER
 * included in any returned payload.
 */
import { DEFAULT_PROFILE_ID, imageUrl } from '../../common/media.js';

/** moderation.state -> the label the legacy `items.status` carried (clients show it as-is). */
const MODERATION_LABEL = { approved: 'Approved', pending: 'Pending', rejected: 'Review' };

const isHidden = (ad) => ad.status !== 'active' || ad.moderation?.state !== 'approved';

function firstImageId(ad) {
  const images = Array.isArray(ad.images) ? [...ad.images].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];
  return images.length > 0 ? images[0].id : null;
}

export class GratisService {
  /** @param {import('./gratis.repository.js').GratisRepository} gratisRepository */
  constructor(gratisRepository) {
    this.repo = gratisRepository;
  }

  async getItemSnapshot(itemId) {
    const ad = await this.repo.getItemById(itemId);
    // A soft-deleted ad is treated as gone (the main site used to hard-delete: findByIdAndDelete).
    if (!ad || ad.status === 'deleted') return null;
    const imageId = firstImageId(ad);
    return {
      itemId: String(ad._id),
      title: ad.title ?? '',
      thumbnailUrl: imageId ? imageUrl(imageId) : null,
      imageId,
      price: ad.priceMinor == null ? null : ad.priceMinor / 100, // nullable — passes through
      priceMinor: ad.priceMinor ?? null,
      status: MODERATION_LABEL[ad.moderation?.state] ?? null,
      sellerId: ad.addedBy ? String(ad.addedBy) : null,
      hidden: isHidden(ad),
    };
  }

  /** @returns {Promise<Map<string, string|null>>} legacy moderation label per ad id (missing ads -> null) */
  async getItemStatuses(ids) {
    const ads = await this.repo.getItemsByIds(ids);
    return new Map(ads.map((ad) => [String(ad._id), MODERATION_LABEL[ad.moderation?.state] ?? null]));
  }

  /** True if the seller of `itemId` accepted `buyerId`'s offer on it. */
  async hasAcceptedBid(itemId, buyerId) {
    return this.repo.hasAcceptedBid(itemId, buyerId);
  }

  /** True if a user with this id exists (used to reject blocking a non-existent user). */
  async userExists(id) {
    const user = await this.repo.getUserById(id);
    return Boolean(user);
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
    // The main site always showed an avatar: a user without one gets the default picture.
    return { displayName, avatarUrl: imageUrl(user.profilePicture || DEFAULT_PROFILE_ID) };
  }

  #deriveDisplayName(user) {
    const full = [user.firstname, user.lastname]
      .filter((s) => s && String(s).trim())
      .join(' ')
      .trim();
    if (full) return full;
    // Email local-part fallback — privacy-gated: only when the user has not hidden their email.
    if (user.privacy?.showEmail !== false && typeof user.email === 'string' && user.email.includes('@')) {
      const local = user.email.split('@')[0].trim();
      if (local) return local;
    }
    return 'User';
  }
}

export default GratisService;
