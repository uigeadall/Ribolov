/**
 * Generate a JPEG poster image from the first frame of a local video file.
 *
 * Lazy-required so a build missing the native module (Expo Go, older dev
 * clients) still loads — same pattern as expo-video / expo-dynamic-app-icon.
 * `generateThumbnail` resolves to null in that case, and the upload pipeline
 * skips the thumbnail leg without failing the whole catch save.
 *
 * We also run the JPEG through expo-image-manipulator to shrink it to a
 * feed-friendly width (800px) and re-encode at q=0.7. A 1080p frame straight
 * from the picker is ~1.5 MB; the resized version is ~80-120 KB — the
 * difference matters because the poster is downloaded on every feed scroll
 * past a video card, and we want it to arrive before the video itself
 * starts buffering.
 */
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

type ThumbnailsMod = typeof import('expo-video-thumbnails');

let cachedMod: ThumbnailsMod | null | undefined = undefined;

function loadMod(): ThumbnailsMod | null {
  if (cachedMod !== undefined) return cachedMod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedMod = require('expo-video-thumbnails') as ThumbnailsMod;
  } catch {
    cachedMod = null;
  }
  return cachedMod;
}

/**
 * Returns a local file:// URI for the resized JPEG poster, or null when the
 * thumbnail couldn't be generated (native module missing, unsupported codec,
 * file:// permission issue, etc.). Callers should treat null as "no poster
 * available" — the inline player still works, just without the first-frame
 * preview.
 *
 * @param videoUri  file:// URI of the picked video
 * @param atMs      Position to capture, default 250ms in. Frame 0 of an iPhone
 *                  clip is often a partial fade-in; 250ms picks a frame that's
 *                  visually settled. Bounded to the video's actual length
 *                  inside the library.
 */
export async function generateVideoThumbnail(
  videoUri: string,
  atMs: number = 250,
): Promise<string | null> {
  const mod = loadMod();
  if (!mod) return null;
  if (!videoUri || !videoUri.startsWith('file://')) return null;
  try {
    const { uri } = await mod.getThumbnailAsync(videoUri, { time: atMs, quality: 0.8 });
    // Shrink to 800px wide so the poster download stays cheap. We keep
    // height proportional via the resize-by-width form (only width set).
    const resized = await manipulateAsync(
      uri,
      [{ resize: { width: 800 } }],
      { compress: 0.7, format: SaveFormat.JPEG },
    );
    return resized.uri;
  } catch {
    return null;
  }
}
