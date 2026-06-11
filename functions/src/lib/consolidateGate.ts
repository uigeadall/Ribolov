/**
 * Decision gate for consolidateLeaderboards: should this scheduled run do
 * the ~800-read consolidation, or exit after the 1-read meta check?
 *
 * Run when:
 *  - the period-bucket key changed since the last consolidation (midnight /
 *    week / month / year rollover — the "day" cache doc must reset to an
 *    empty board even if nobody logged a catch overnight), or
 *  - a rollup write landed after the last consolidation covered it.
 *
 * Skip when buckets are unchanged and no rollup write is newer than what
 * the last consolidation already processed. consolidatedThroughMillis is
 * set to the lastRollupWriteAt value READ AT THE START of the consolidation
 * run (not "now") so a rollup write that lands mid-run still triggers the
 * next cycle instead of being silently skipped.
 */
export function shouldConsolidate(args: {
  lastRollupWriteAtMillis: number | null;
  consolidatedThroughMillis: number | null;
  currentBucketsKey: string;
  lastBucketsKey: string | null;
}): boolean {
  if (args.currentBucketsKey !== args.lastBucketsKey) return true;
  if (args.lastRollupWriteAtMillis === null) return false;
  if (args.consolidatedThroughMillis === null) return true;
  return args.lastRollupWriteAtMillis > args.consolidatedThroughMillis;
}
