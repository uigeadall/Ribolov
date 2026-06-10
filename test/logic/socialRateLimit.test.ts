import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allowBurst,
  resetRateLimits,
  allowComment,
  allowLikeToggle,
  allowPostCreate,
  allowStoryPost,
} from '../../src/services/socialRateLimit';

const T0 = 1_000_000;

describe('socialRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    resetRateLimits();
  });
  afterEach(() => {
    resetRateLimits();
    vi.useRealTimers();
  });

  describe('allowBurst', () => {
    it('allows up to max within the window, then blocks', () => {
      expect(allowBurst('k', 3, 60_000)).toBe(true);
      expect(allowBurst('k', 3, 60_000)).toBe(true);
      expect(allowBurst('k', 3, 60_000)).toBe(true);
      expect(allowBurst('k', 3, 60_000)).toBe(false);
      expect(allowBurst('k', 3, 60_000)).toBe(false);
    });

    it('refills after the window elapses (pruning)', () => {
      for (let i = 0; i < 3; i++) allowBurst('k', 3, 60_000);
      expect(allowBurst('k', 3, 60_000)).toBe(false);
      vi.setSystemTime(T0 + 60_001); // whole window has passed
      expect(allowBurst('k', 3, 60_000)).toBe(true);
    });

    it('partially refills as individual timestamps age out', () => {
      allowBurst('k', 2, 60_000); // t = T0
      vi.setSystemTime(T0 + 30_000);
      allowBurst('k', 2, 60_000); // t = T0+30s — now full
      expect(allowBurst('k', 2, 60_000)).toBe(false);
      vi.setSystemTime(T0 + 60_001); // first ts aged out, second still live
      expect(allowBurst('k', 2, 60_000)).toBe(true); // one slot freed
      expect(allowBurst('k', 2, 60_000)).toBe(false); // full again
    });

    it('keeps buckets independent per key', () => {
      expect(allowBurst('a', 1, 60_000)).toBe(true);
      expect(allowBurst('a', 1, 60_000)).toBe(false);
      expect(allowBurst('b', 1, 60_000)).toBe(true);
    });
  });

  describe('resetRateLimits', () => {
    it('clears state so the next caller starts fresh (logout)', () => {
      allowBurst('k', 1, 60_000);
      expect(allowBurst('k', 1, 60_000)).toBe(false);
      resetRateLimits();
      expect(allowBurst('k', 1, 60_000)).toBe(true);
    });
  });

  describe('operation limiters', () => {
    it('allowComment caps at 30/min', () => {
      for (let i = 0; i < 30; i++) expect(allowComment('u')).toBe(true);
      expect(allowComment('u')).toBe(false);
    });

    it('allowLikeToggle enforces a 220ms minimum spacing', () => {
      expect(allowLikeToggle('u')).toBe(true);
      expect(allowLikeToggle('u')).toBe(false); // same instant, < 220ms
      vi.setSystemTime(T0 + 230);
      expect(allowLikeToggle('u')).toBe(true);
    });

    it('allowPostCreate caps at 5/min even when spacing is respected', () => {
      let t = T0;
      let allowed = 0;
      for (let i = 0; i < 12; i++) {
        if (allowPostCreate('u')) allowed++;
        t += 1000; // 1s apart, always clears the 800ms spacing gate
        vi.setSystemTime(t);
      }
      expect(allowed).toBe(5);
    });
  });

  describe('eviction-window invariant', () => {
    // The documented hazard: if the cap window were treated as ~5 min, an
    // hour-long limiter would silently reset mid-window. Assert that an
    // hour-window cap is STILL enforced 6 minutes in, and only refills after
    // the full hour.
    it('allowStoryPost (8/hour) stays blocked at 6 min, refills after 1h', () => {
      for (let i = 0; i < 8; i++) expect(allowStoryPost('u')).toBe(true);
      expect(allowStoryPost('u')).toBe(false);
      vi.setSystemTime(T0 + 6 * 60_000); // 6 minutes later
      expect(allowStoryPost('u')).toBe(false); // window is an hour, not minutes
      vi.setSystemTime(T0 + 3_600_001); // full hour elapsed
      expect(allowStoryPost('u')).toBe(true);
    });
  });
});
