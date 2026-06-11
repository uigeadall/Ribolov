import { describe, expect, it } from 'vitest';
import { shouldConsolidate } from '../../functions/src/lib/consolidateGate';

const BUCKETS_A = 'day_2026-06-11|week_2026-W24|month_2026-06|year_2026';
const BUCKETS_B = 'day_2026-06-12|week_2026-W24|month_2026-06|year_2026';

describe('shouldConsolidate', () => {
  it('runs when the bucket key changed (midnight rollover resets the day board)', () => {
    expect(shouldConsolidate({
      lastRollupWriteAtMillis: null,
      consolidatedThroughMillis: null,
      currentBucketsKey: BUCKETS_B,
      lastBucketsKey: BUCKETS_A,
    })).toBe(true);
  });

  it('runs on a fresh meta doc with no recorded bucket key', () => {
    expect(shouldConsolidate({
      lastRollupWriteAtMillis: null,
      consolidatedThroughMillis: null,
      currentBucketsKey: BUCKETS_A,
      lastBucketsKey: null,
    })).toBe(true);
  });

  it('skips when buckets match and no rollup write was ever recorded', () => {
    expect(shouldConsolidate({
      lastRollupWriteAtMillis: null,
      consolidatedThroughMillis: 1000,
      currentBucketsKey: BUCKETS_A,
      lastBucketsKey: BUCKETS_A,
    })).toBe(false);
  });

  it('runs when rollup writes exist but were never consolidated', () => {
    expect(shouldConsolidate({
      lastRollupWriteAtMillis: 1000,
      consolidatedThroughMillis: null,
      currentBucketsKey: BUCKETS_A,
      lastBucketsKey: BUCKETS_A,
    })).toBe(true);
  });

  it('runs when a rollup write is newer than the last consolidation', () => {
    expect(shouldConsolidate({
      lastRollupWriteAtMillis: 2000,
      consolidatedThroughMillis: 1000,
      currentBucketsKey: BUCKETS_A,
      lastBucketsKey: BUCKETS_A,
    })).toBe(true);
  });

  it('skips when consolidation already covers the newest rollup write', () => {
    expect(shouldConsolidate({
      lastRollupWriteAtMillis: 1000,
      consolidatedThroughMillis: 1000,
      currentBucketsKey: BUCKETS_A,
      lastBucketsKey: BUCKETS_A,
    })).toBe(false);
  });
});
