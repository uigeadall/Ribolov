import { describe, expect, it, vi } from 'vitest';

// imageSize imports Alert from react-native; stub it so the module loads in node.
vi.mock('react-native', () => ({ Alert: { alert: () => {} } }));

import { checkImageSize, checkImageSizes, MAX_IMAGE_BYTES } from '../../src/utils/imageSize';

describe('checkImageSize', () => {
  it('passes when fileSize is within the cap, at the cap, or unknown', () => {
    expect(checkImageSize({ fileSize: 1000 })).toBe(true);
    expect(checkImageSize({})).toBe(true); // unknown -> rely on server rule
    expect(checkImageSize({ fileSize: null })).toBe(true);
    expect(checkImageSize({ fileSize: MAX_IMAGE_BYTES })).toBe(true); // exactly at cap
  });

  it('fails when fileSize exceeds the cap', () => {
    expect(checkImageSize({ fileSize: MAX_IMAGE_BYTES + 1 })).toBe(false);
  });
});

describe('checkImageSizes', () => {
  it('fails on the first oversize asset, passes when all are within cap', () => {
    expect(checkImageSizes([{ fileSize: 1 }, { fileSize: MAX_IMAGE_BYTES + 1 }, { fileSize: 1 }])).toBe(false);
    expect(checkImageSizes([{ fileSize: 1 }, { fileSize: 2 }])).toBe(true);
  });
});
