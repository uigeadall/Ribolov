import { describe, expect, it } from 'vitest';
import {
  isVideoOverLimit,
  VIDEO_MAX_MS,
  VIDEO_OVERAGE_TOLERANCE_MS,
} from '../../src/utils/videoLimits';

describe('isVideoOverLimit', () => {
  it('treats unknown / zero / negative durations as within limit', () => {
    expect(isVideoOverLimit(null)).toBe(false);
    expect(isVideoOverLimit(undefined)).toBe(false);
    expect(isVideoOverLimit(0)).toBe(false);
    expect(isVideoOverLimit(-5)).toBe(false);
  });

  it('allows durations up to the cap plus the rounding tolerance', () => {
    expect(isVideoOverLimit(VIDEO_MAX_MS)).toBe(false); // exactly 15s
    expect(isVideoOverLimit(VIDEO_MAX_MS + VIDEO_OVERAGE_TOLERANCE_MS)).toBe(false); // 15.5s edge
  });

  it('rejects durations beyond cap + tolerance', () => {
    expect(isVideoOverLimit(VIDEO_MAX_MS + VIDEO_OVERAGE_TOLERANCE_MS + 1)).toBe(true);
    expect(isVideoOverLimit(30_000)).toBe(true);
  });
});
