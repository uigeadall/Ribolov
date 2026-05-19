import { Alert } from 'react-native';

/** Matches the 10 MB cap enforced by storage.rules underLimit(). Keeping the
    pre-check client-side avoids the "spinner → storage/unauthorized" UX. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const MAX_MB_LABEL = Math.round(MAX_IMAGE_BYTES / (1024 * 1024));

/** Returns true if the picked asset is within the size cap; otherwise shows an
    Alert and returns false. Some pickers don't report fileSize (web, old SDK
    versions, certain Android devices) — in that case we let the upload proceed
    and rely on the server-side rule as the final guard. */
export function checkImageSize(asset: { fileSize?: number | null }): boolean {
  if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_IMAGE_BYTES) {
    Alert.alert(
      'Файлът е твърде голям',
      `Снимките са ограничени до ${MAX_MB_LABEL} MB. Избери по-малка.`,
    );
    return false;
  }
  return true;
}

/** Bulk variant: returns true only if every asset is within the cap. Stops at
    the first oversize asset, shows one Alert, returns false. */
export function checkImageSizes(assets: { fileSize?: number | null }[]): boolean {
  for (const a of assets) {
    if (!checkImageSize(a)) return false;
  }
  return true;
}
