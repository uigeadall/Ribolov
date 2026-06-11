/**
 * One-off backfill: write the denormalized `commentCount` field onto
 * publicCatches docs that pre-date it.
 *
 * WHY: feed cards render "View N comments" from `commentCount` with zero
 * reads; docs missing the field fall back to a count() aggregation read per
 * card per mount. New catches seed the field at publish — this script
 * brings old docs up to par so the fallback path dies out.
 *
 * WHAT IT DOES: for each publicCatches doc missing `commentCount`, runs a
 * count() aggregation over its comments subcollection and writes the result.
 * Docs that already have the field are skipped (re-running is safe).
 *
 * RUNNING (from the functions/ directory):
 *   # Credentials: Admin SDK uses Application Default Credentials:
 *   #   gcloud auth application-default login
 *   node scripts/backfillCommentCounts.js              # DRY RUN — reports only
 *   node scripts/backfillCommentCounts.js --apply      # writes the counts
 *   node scripts/backfillCommentCounts.js --project=<id> --apply
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');

// Same project resolution as scrubEmailNames.js: flag > env > .firebaserc.
function resolveProjectId() {
  const flag = process.argv.find((a) => a.startsWith('--project='));
  if (flag) return flag.slice('--project='.length);
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  try {
    const rc = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../.firebaserc'), 'utf8'));
    return rc.projects && rc.projects.default;
  } catch {
    return undefined;
  }
}

const projectId = resolveProjectId();
if (!projectId) {
  console.error('Could not resolve a project id. Pass --project=<id> or set GOOGLE_CLOUD_PROJECT.');
  process.exit(1);
}

// Credentials come from Application Default Credentials. If a query later
// fails with an auth error (rather than the project-id error), run
// `gcloud auth application-default login` or set GOOGLE_APPLICATION_CREDENTIALS.
admin.initializeApp({ projectId });
const db = admin.firestore();

async function main() {
  console.log(`[backfillCommentCounts] project=${projectId} mode=${APPLY ? 'APPLY' : 'DRY RUN'}`);
  const snap = await db.collection('publicCatches').get();
  let skipped = 0;
  let updated = 0;
  for (const docSnap of snap.docs) {
    if (typeof docSnap.get('commentCount') === 'number') {
      skipped += 1;
      continue;
    }
    const agg = await docSnap.ref.collection('comments').count().get();
    const count = agg.data().count;
    console.log(`  ${docSnap.id}: commentCount=${count}`);
    if (APPLY) {
      await docSnap.ref.set({ commentCount: count }, { merge: true });
    }
    updated += 1;
  }
  console.log(`[backfillCommentCounts] done. ${updated} ${APPLY ? 'updated' : 'would update'}, ${skipped} already had the field.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
