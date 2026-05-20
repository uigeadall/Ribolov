/**
 * Image-variant URL builder.
 *
 * Photos uploaded via `uploadLocalPhotoToStorage` are processed by Firebase's
 * Resize Images extension. The extension produces sized variants in the same
 * Storage folder and (by default) deletes the original. At feed-scroll scale
 * loading the full 1200×1200 for every 3-col grid thumb is the single biggest
 * bandwidth cost, so this helper rewrites the URL to a smaller variant when
 * one is available.
 *
 * IMPORTANT: rewriting only happens when `EXTENSION_PRODUCES_VARIANTS` below
 * is true. By default the extension only produces a single `_1200x1200.webp`
 * variant — rewriting to `_400x400.webp` would 404 those URLs and break
 * every image in the app. Flip the flag ONLY after reconfiguring the
 * extension in Firebase Console:
 *
 *   1. Firebase Console → Extensions → Resize Images
 *   2. Reconfigure → IMG_SIZES = `400x400,800x800,1200x1200`
 *   3. Wait for the extension to backfill (it does NOT auto-regenerate old
 *      photos — only NEW uploads get the new sizes). Worst case you also
 *      run a one-time backfill script that re-triggers resize.
 *   4. Flip the flag to true, ship, then bandwidth costs drop.
 *
 * Until step 4, the helper is a passthrough — full 1200×1200 URLs are still
 * served, no win yet but no breakage either.
 *
 * @param uri  Firebase Storage download URL.
 * @param size Desired largest dimension in pixels. Snapped to 400/800/1200.
 */

// Flip to true after the Resize Images extension is producing 400/800/1200.
// Hardcoded for now — could be promoted to a remote config flag later so the
// transition can be staged without a release.
const EXTENSION_PRODUCES_VARIANTS = false;

export function getImageVariant(uri: string | undefined, size: 400 | 800 | 1200): string | undefined {
  if (!uri) return uri;
  // While the extension only produces a single variant, never rewrite — the
  // smaller URLs don't exist in Storage and would 404.
  if (!EXTENSION_PRODUCES_VARIANTS) return uri;

  // Only rewrite Storage URLs that already point at a sized variant. Local
  // file:// URIs, Cloudinary URLs, data URLs, etc. pass through unchanged.
  const variantMatch = uri.match(/_(\d+)x(\d+)\.webp(\?|$)/);
  if (!variantMatch) return uri;

  const currentW = parseInt(variantMatch[1], 10);
  // If the requested size is >= the current variant, no point downsizing.
  if (size >= currentW) return uri;

  // Snap to known variants. The extension must produce all three.
  const target = size <= 400 ? '400x400' : size <= 800 ? '800x800' : '1200x1200';
  return uri.replace(/_\d+x\d+\.webp/, `_${target}.webp`);
}

/** Convenience presets for common render contexts. Centralizes the
    size-per-context decision so we can tune from one place. */
export const ImageSize = {
  /** 3-column profile / hashtag grid thumbnails. */
  gridThumb: 400 as const,
  /** Avatar (any size up to 100px on screen). */
  avatar: 400 as const,
  /** FeedPost / PostCard main photo (full screen width). */
  feed: 800 as const,
  /** Full-screen ImageViewer / share-card capture. */
  full: 1200 as const,
};
