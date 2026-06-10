import { describe, expect, it } from 'vitest';
import {
  dayBucketKey,
  isoWeekBucketKey,
  monthBucketKey,
  yearBucketKey,
  bucketsForDate,
  rollupDocId,
  ttlDateForBucket,
} from '../../functions/src/lib/buckets';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const DAY_MS = 86_400_000;

describe('bucket keys', () => {
  it('day/month/year keys are UTC and zero-padded', () => {
    const d = utc(2026, 6, 9);
    expect(dayBucketKey(d)).toBe('day_2026-06-09');
    expect(monthBucketKey(d)).toBe('month_2026-06');
    expect(yearBucketKey(d)).toBe('year_2026');
  });

  it('ISO-week key handles the year boundary in both directions', () => {
    // 2026-01-01 is a Thursday → ISO week 1 of 2026.
    expect(isoWeekBucketKey(utc(2026, 1, 1))).toBe('week_2026-W01');
    // 2027-01-01 is a Friday → its ISO week belongs to 2026-W53.
    expect(isoWeekBucketKey(utc(2027, 1, 1))).toBe('week_2026-W53');
    // 2025-12-29 (Monday) → its Thursday is 2026-01-01 → 2026-W01.
    expect(isoWeekBucketKey(utc(2025, 12, 29))).toBe('week_2026-W01');
  });
});

describe('bucketsForDate', () => {
  it('returns one bucket per period in day/week/month/year order', () => {
    const buckets = bucketsForDate(utc(2026, 6, 9));
    expect(buckets.map((b) => b.period)).toEqual(['day', 'week', 'month', 'year']);
    expect(buckets[0].bucket).toBe('day_2026-06-09');
    expect(buckets[3].bucket).toBe('year_2026');
  });
});

describe('rollupDocId', () => {
  it('joins bucket and owner uid with an underscore', () => {
    expect(rollupDocId('week_2026-W24', 'alice')).toBe('week_2026-W24_alice');
  });
});

describe('ttlDateForBucket', () => {
  it('offsets day/week/month by the configured TTL and never expires year', () => {
    const d = utc(2026, 6, 9);
    expect(ttlDateForBucket('year', d)).toBeNull();
    expect(ttlDateForBucket('day', d)!.getTime() - d.getTime()).toBe(35 * DAY_MS);
    expect(ttlDateForBucket('week', d)!.getTime() - d.getTime()).toBe(60 * DAY_MS);
    expect(ttlDateForBucket('month', d)!.getTime() - d.getTime()).toBe(400 * DAY_MS);
  });

  it('does not mutate the input date', () => {
    const d = utc(2026, 6, 9);
    const before = d.getTime();
    ttlDateForBucket('day', d);
    expect(d.getTime()).toBe(before);
  });
});
