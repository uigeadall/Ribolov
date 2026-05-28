// Cloudflare R2 upload helper. Replaces the Firebase Storage upload paths
// that previously lived in catchSync.ts, posts.ts, stories.ts, userProfile.ts,
// damFeed.ts and ChatDetailScreen.tsx. The migration is documented in the
// session that introduced this file; the short version:
//   - We pay Firebase Storage egress per GB; R2 egress is free. For a media-
//     heavy social app, that line item is the dominant cost.
//   - Auth is handled by a Cloud Function (`getR2UploadUrl`) that mints a
//     presigned PUT URL bound to the caller's uid namespace. The client never
//     holds R2 credentials.
//   - Image resize is done client-side via expo-image-manipulator. We drop
//     the Firebase "Resize Images" extension dependency entirely (the
//     `waitForResizedUrl` polling loop is gone with it).
import { Image } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { requireFirebase } from './firebase';

export type UploadProgressFn = (fraction: number) => void;

export type R2UploadResult = {
  /** Public CDN URL — store this on the Firestore doc. */
  url: string;
  /** R2 object key (e.g. `stories/<uid>/<ts>.jpg`) — store this too so we
      can call `deleteFromR2(path)` later without parsing it back out of
      the URL. */
  storagePath: string;
};

type GetUploadUrlResponse = {
  uploadUrl: string;
  publicUrl: string;
  key: string;
};

/** Lazy import of firebase/functions so apps that never upload media don't
    pay the cold-start cost. The same pattern is used elsewhere (e.g.
    `deleteMyAccountCloudCascade` in userProfile.ts) for the same reason. */
async function callGetUploadUrl(path: string, contentType: string): Promise<GetUploadUrlResponse> {
  const fb = requireFirebase();
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const fns = getFunctions(fb.app);
  const fn = httpsCallable<{ path: string; contentType: string }, GetUploadUrlResponse>(
    fns,
    'getR2UploadUrl',
  );
  const res = await fn({ path, contentType });
  return res.data;
}

async function callDeleteObject(path: string): Promise<void> {
  const fb = requireFirebase();
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const fns = getFunctions(fb.app);
  const fn = httpsCallable<{ path: string }, { ok: boolean }>(fns, 'deleteR2Object');
  // Best-effort — same shape as the previous deleteObject() calls. An orphan
  // object in R2 is harmless (storage is $0.015/GB-mo; trivial) but raising
  // here would break flows like `deleteStoryMedia` that expect silent
  // failure when the file's already gone.
  await fn({ path }).catch(() => {});
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts - 1) {
        await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
      }
    }
  }
  throw lastErr;
}

export type ResizeOptions = {
  /** Max width OR height in pixels. Source is scaled so the longer side
      hits this cap; the other side scales proportionally. Default 1600 —
      a Story / catch photo at 1600px long-edge JPEG ≈ 200-500KB, which is
      indistinguishable on a phone screen from the original 4032×3024
      iPhone shot but uploads ~20× faster. */
  maxDimension?: number;
  /** JPEG quality 0..1. Default 0.85 — sweet spot between size and
      perceived quality; below 0.7 you start seeing banding in skies. */
  quality?: number;
};

/** Resize + recompress to JPEG client-side. Skips the resize step when the
    source is already under the cap (avoids unnecessary upscaling / re-encoding
    for screenshots and pre-shrunk assets). Always re-encodes to JPEG so the
    upload contentType matches what the server's whitelist expects, regardless
    of whether the source was HEIC, PNG, etc. */
export async function resizeImageForUpload(
  uri: string,
  opts?: ResizeOptions,
): Promise<{ uri: string; contentType: string }> {
  const maxDim = opts?.maxDimension ?? 1600;
  const quality = opts?.quality ?? 0.85;

  let dims: { width: number; height: number } | null = null;
  try {
    dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
    });
  } catch {
    // getSize occasionally rejects on file:// URIs returned by ImagePicker
    // on older Android — fall back to running resize unconditionally on the
    // long axis. Worse case the source is small and we slightly re-encode.
    dims = null;
  }

  // Source is already under the cap — just recompress, don't upscale.
  if (dims && Math.max(dims.width, dims.height) <= maxDim) {
    const result = await manipulateAsync(uri, [], {
      compress: quality,
      format: SaveFormat.JPEG,
    });
    return { uri: result.uri, contentType: 'image/jpeg' };
  }

  // Resize on the longer dimension so the other side scales proportionally.
  const action = !dims || dims.width >= dims.height
    ? { resize: { width: maxDim } }
    : { resize: { height: maxDim } };
  const result = await manipulateAsync(uri, [action], {
    compress: quality,
    format: SaveFormat.JPEG,
  });
  return { uri: result.uri, contentType: 'image/jpeg' };
}

/** Low-level R2 upload — does no resize. Used by the typed wrappers below.
    Exposed because chat media + dam-feed uploads currently always JPEG and
    benefit from passing a pre-resized URI through unchanged. */
export async function uploadToR2(
  localUri: string,
  storagePath: string,
  contentType: string,
  onProgress?: UploadProgressFn,
): Promise<R2UploadResult> {
  return withRetry(async () => {
    // Sanity-check the source file before doing anything else. ImagePicker
    // sometimes returns a path whose temp file has been GC'd between
    // capture and upload (an Expo Go quirk during background sync) — without
    // this, FileSystem.createUploadTask silently sends 0 bytes and R2
    // happily stores an empty object.
    const info = await FileSystem.getInfoAsync(localUri);
    if (!info.exists) throw new Error(`Source file missing: ${localUri}`);
    const fileSize = 'size' in info && typeof info.size === 'number' ? info.size : 0;
    if (fileSize === 0) throw new Error(`Source file is 0 bytes: ${localUri}`);

    const { uploadUrl, publicUrl, key } = await callGetUploadUrl(storagePath, contentType);

    const task = FileSystem.createUploadTask(
      uploadUrl,
      localUri,
      {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: { 'Content-Type': contentType },
      },
      onProgress
        ? (p) => {
            const total = p.totalBytesExpectedToSend || fileSize || 1;
            const sent = p.totalBytesSent || 0;
            onProgress(Math.max(0, Math.min(1, sent / total)));
          }
        : undefined,
    );
    const result = await task.uploadAsync();
    if (!result) throw new Error('R2 upload returned no result');
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`R2 upload HTTP ${result.status}: ${result.body?.slice(0, 200) ?? ''}`);
    }
    return { url: publicUrl, storagePath: key };
  });
}

/** Upload an image: resize → JPEG → PUT to R2. The storage path's extension
    is normalised to `.jpg` because the resize step always produces JPEG. */
export async function uploadImageToR2(
  localUri: string,
  storagePath: string,
  onProgress?: UploadProgressFn,
  resizeOpts?: ResizeOptions,
): Promise<R2UploadResult> {
  const { uri, contentType } = await resizeImageForUpload(localUri, resizeOpts);
  const adjustedPath = storagePath.replace(/\.[^.]+$/, '.jpg');
  return uploadToR2(uri, adjustedPath, contentType, onProgress);
}

/** Upload a video as-is (no transcoding). Stories cap at 15s, so a typical
    file is 3-10MB — small enough that pre-upload transcode would mostly be
    a battery drain. If we later add longer-form video, switch this to
    Cloudflare Stream rather than re-encoding on-device. */
export async function uploadVideoToR2(
  localUri: string,
  storagePath: string,
  onProgress?: UploadProgressFn,
): Promise<R2UploadResult> {
  return uploadToR2(localUri, storagePath, 'video/mp4', onProgress);
}

/** Best-effort delete via the Cloud Function. Swallows errors silently —
    same contract as the old `deleteObject(ref(storage, path))` calls it
    replaces. An orphan R2 object is harmless and not user-visible. */
export async function deleteFromR2(storagePath: string | undefined | null): Promise<void> {
  if (!storagePath) return;
  await callDeleteObject(storagePath);
}

/** True when a URL points at our R2 public CDN. Used by the cleanup paths
    that have only the URL (not the storage key) — they extract the key by
    stripping the public-base prefix and route through `deleteFromR2`. */
export function isR2Url(url: string | undefined | null): boolean {
  if (!url) return false;
  // Both `https://pub-<id>.r2.dev/...` and a future custom domain start with
  // a recognisable r2.dev host or are owned by the app. We match conservatively:
  // any `r2.dev` host plus the custom-domain literal once configured.
  return /^https:\/\/pub-[a-z0-9]+\.r2\.dev\//i.test(url) ||
    /^https:\/\/[^/]+\.r2\.dev\//i.test(url);
}

/** Derive the R2 object key from a public CDN URL. Returns null if the URL
    doesn't look like one of ours. Mirrors the existing
    `decodeURIComponent(url).match(/\/o\/([^?]+)/)` pattern that catchSync.ts
    used for the Firebase Storage URL → path inversion. */
export function r2KeyFromUrl(url: string | undefined | null): string | null {
  if (!isR2Url(url)) return null;
  try {
    const parsed = new URL(url!);
    // Strip the leading `/` — R2 keys are stored without it.
    const key = parsed.pathname.replace(/^\//, '');
    return key || null;
  } catch {
    return null;
  }
}
