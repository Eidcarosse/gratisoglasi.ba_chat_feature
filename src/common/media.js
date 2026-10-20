/**
 * Layer: Common. Cloudflare image ids (what the shared DB stores) <-> delivery URLs (what the legacy
 * clients see). The account hash must equal the Fastify BE's and the legacy main BE's.
 */
import { config } from '../config/index.js';

export const DEFAULT_PROFILE_ID = 'e0452e1f-1270-461a-fec0-a14322ab9400';

export function imageUrl(id) {
  return `https://imagedelivery.net/${config.CF_IMAGES_ACCOUNT_HASH}/${id}/${config.CLOUDFLARE_IMAGES_VARIANT}`;
}

/** Second-to-last path segment of a Cloudflare Images URL (the image id), or null. */
export function imageIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    return segments.length >= 2 ? segments[segments.length - 2] : null;
  } catch {
    return null;
  }
}
