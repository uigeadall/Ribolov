// Pure leaderboard bucketing helpers — UTC date math only, no firebase-admin
// dependency, so they can be unit-tested directly. The Timestamp-returning
// wrapper (ttlForBucket) lives in index.ts and delegates to ttlDateForBucket.

export type Period = "day" | "week" | "month" | "year";

export function dayBucketKey(d: Date): string {
  return `day_${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function isoWeekBucketKey(d: Date): string {
  // ISO-8601 week: weeks start Monday, week 1 contains the first Thursday
  // of the year.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const diff = (t.getTime() - firstThu.getTime()) / 86400000;
  const week = 1 + Math.round((diff - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `week_${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function monthBucketKey(d: Date): string {
  return `month_${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function yearBucketKey(d: Date): string {
  return `year_${d.getUTCFullYear()}`;
}

export function bucketsForDate(date: Date): Array<{ period: Period; bucket: string }> {
  return [
    { period: "day", bucket: dayBucketKey(date) },
    { period: "week", bucket: isoWeekBucketKey(date) },
    { period: "month", bucket: monthBucketKey(date) },
    { period: "year", bucket: yearBucketKey(date) },
  ];
}

// TTL durations per bucket period. Day buckets become irrelevant the moment
// the day rolls over; we keep them ~5 weeks just to allow late drift fixes
// to inspect them. Week ~2mo, month ~13mo, year never (year buckets need
// to live for at least a year to be queryable as "current year").
export const TTL_DAYS: Record<Period, number | null> = {
  day: 35,
  week: 60,
  month: 400,
  year: null,
};

/** Pure: the wall-clock Date at which a bucket should expire, or null for
    buckets that never expire (year). index.ts wraps this in Timestamp.fromDate. */
export function ttlDateForBucket(period: Period, date: Date): Date | null {
  const days = TTL_DAYS[period];
  if (days == null) return null;
  const t = new Date(date);
  t.setUTCDate(t.getUTCDate() + days);
  return t;
}

export function rollupDocId(bucket: string, ownerUid: string): string {
  return `${bucket}_${ownerUid}`;
}
