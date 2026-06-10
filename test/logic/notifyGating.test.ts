import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldNotify, quietHoursActive } from '../../functions/src/lib/notifyGating';

const allOn = {
  likes: true, comments: true, follows: true,
  messages: true, storyReactions: true, mentions: true,
};

describe('shouldNotify', () => {
  it('maps each known type to its preference flag', () => {
    expect(shouldNotify('like', allOn)).toBe(true);
    expect(shouldNotify('comment', allOn)).toBe(true);
    expect(shouldNotify('follow', allOn)).toBe(true);
    expect(shouldNotify('message', allOn)).toBe(true);
    expect(shouldNotify('mention', allOn)).toBe(true);
    expect(shouldNotify('storyLike', allOn)).toBe(true);
    expect(shouldNotify('storyComment', allOn)).toBe(true);
  });

  it('respects a disabled preference', () => {
    expect(shouldNotify('like', { ...allOn, likes: false })).toBe(false);
    expect(shouldNotify('storyComment', { ...allOn, storyReactions: false })).toBe(false);
    // a different type is unaffected by the disabled flag
    expect(shouldNotify('comment', { ...allOn, likes: false })).toBe(true);
  });

  it('defaults unknown / undefined types to true (transactional)', () => {
    expect(shouldNotify('tournamentReminder', allOn)).toBe(true);
    expect(shouldNotify(undefined, allOn)).toBe(true);
  });
});

describe('quietHoursActive', () => {
  // Pin a known UTC instant; the helper reads the current hour via Intl, so we
  // set the system clock and use timezone 'UTC' to make the hour deterministic.
  const atUtcHour = (h: number) => {
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 9, h, 0, 0)));
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns false when disabled or under-specified', () => {
    atUtcHour(23);
    expect(quietHoursActive({ quietHoursEnabled: false, quietHoursStart: 22, quietHoursEnd: 7, timezone: 'UTC' })).toBe(false);
    expect(quietHoursActive({ quietHoursEnabled: true, timezone: 'UTC' })).toBe(false); // no bounds
    expect(quietHoursActive({ quietHoursEnabled: true, quietHoursStart: 5, quietHoursEnd: 5, timezone: 'UTC' })).toBe(false); // empty window
  });

  it('handles a same-day window (13→18): inclusive start, exclusive end', () => {
    const w = { quietHoursEnabled: true, quietHoursStart: 13, quietHoursEnd: 18, timezone: 'UTC' };
    atUtcHour(13); expect(quietHoursActive(w)).toBe(true);  // start inclusive
    atUtcHour(14); expect(quietHoursActive(w)).toBe(true);
    atUtcHour(18); expect(quietHoursActive(w)).toBe(false); // end exclusive
    atUtcHour(20); expect(quietHoursActive(w)).toBe(false);
  });

  it('handles a cross-midnight window (22→7)', () => {
    const w = { quietHoursEnabled: true, quietHoursStart: 22, quietHoursEnd: 7, timezone: 'UTC' };
    atUtcHour(22); expect(quietHoursActive(w)).toBe(true);  // start inclusive
    atUtcHour(23); expect(quietHoursActive(w)).toBe(true);
    atUtcHour(5);  expect(quietHoursActive(w)).toBe(true);  // wraps past midnight
    atUtcHour(7);  expect(quietHoursActive(w)).toBe(false); // end exclusive
    atUtcHour(14); expect(quietHoursActive(w)).toBe(false); // mid-afternoon, awake
  });
});
