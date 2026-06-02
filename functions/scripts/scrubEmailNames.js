/**
 * One-off backfill: scrub leaked email addresses out of public display-name
 * fields.
 *
 * WHY: before the `displayName ?? email ?? 'Рибар'` fallback was removed, a user
 * with no displayName had their EMAIL written as the public `ownerName` /
 * `hostName` / participant name into world-readable documents (and into push
 * notification payloads derived from them). Removing the fallback in client code
 * stops NEW leaks; this script remediates documents already written.
 *
 * WHAT IT TOUCHES (persistent, world/peer-readable name fields):
 *   - publicCatches/{id}.ownerName
 *   - posts/{id}.ownerName
 *   - tournaments/{id}.hostName
 *   - collectionGroup('photoEntries').ownerName        (tournament entries)
 *   - collectionGroup('feedPosts').ownerName            (dam feeds)
 *   - conversations/{id}.participantNames               (map: uid -> name)
 *
 * DELIBERATELY SKIPPED (short-TTL / private — natural decay or not a cross-user
 * leak): liveFishingPins (24h), stories (24h), notifications.actorName (24-48h),
 * users/{uid}/catches (owner-only), leaderboardCache (rebuilt nightly).
 *
 * Any value that looks like an email (a single `local@domain.tld` token) is
 * replaced with the app's neutral fallback name, 'Рибар'.
 *
 * RUNNING (from the functions/ directory):
 *   # Credentials: the Admin SDK uses Application Default Credentials, which are
 *   # SEPARATE from the Firebase CLI login. If you haven't set them up:
 *   #   gcloud auth application-default login        # the usual path
 *   #   # ...or point at a service-account key:
 *   #   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *   # The project id is auto-resolved from .firebaserc — no env var needed
 *   # (override with --project=<id> or GOOGLE_CLOUD_PROJECT if you must).
 *
 *   node scripts/scrubEmailNames.js            # DRY RUN — reports, writes nothing
 *   node scripts/scrubEmailNames.js --apply    # actually writes the scrubbed names
 *
 * Idempotent: a second run finds nothing left to change.
 */

'use strict';

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const FALLBACK_NAME = 'Рибар';
// Whole-string email match (the leaked value was the bare email, nothing else).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BATCH_LIMIT = 400; // Firestore caps a batch at 500 ops; leave margin.

// Resolve the target project explicitly. firebase-admin's auto-detection can't
// find a project id from user ADC (you hit "Unable to detect a Project Id"), so
// we resolve it ourselves: --project=<id> flag > GOOGLE_CLOUD_PROJECT /
// GCLOUD_PROJECT env > the `projects.default` in .firebaserc at the repo root.
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

// Credentials come from Application Default Credentials. If a query later fails
// with an auth error (rather than the project-id error), run
// `gcloud auth application-default login` or set GOOGLE_APPLICATION_CREDENTIALS.
admin.initializeApp({ projectId });
const db = admin.firestore();

const looksLikeEmail = (v) => typeof v === 'string' && EMAIL_RE.test(v.trim());

let scanned = 0;
let wouldChange = 0;
let changed = 0;

/** Commits an array of {ref, data} updates in chunks, respecting the batch cap. */
async function flushUpdates(updates) {
  if (!APPLY || updates.length === 0) return;
  for (let i = 0; i < updates.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + BATCH_LIMIT)) {
      batch.update(u.ref, u.data);
    }
    await batch.commit();
    changed += Math.min(BATCH_LIMIT, updates.length - i);
  }
}

/** Scrub a single string field across a (collection or collectionGroup) query. */
async function scrubStringField(label, query, field) {
  const snap = await query.get();
  const updates = [];
  for (const doc of snap.docs) {
    scanned++;
    const value = doc.get(field);
    if (looksLikeEmail(value)) {
      wouldChange++;
      console.log(`  [${label}] ${doc.ref.path}.${field}: "${value}" -> "${FALLBACK_NAME}"`);
      updates.push({ ref: doc.ref, data: { [field]: FALLBACK_NAME } });
    }
  }
  await flushUpdates(updates);
  console.log(`[${label}] scanned ${snap.size}, matched ${updates.length}`);
}

/** Scrub the participantNames map (uid -> displayName) on conversations. */
async function scrubConversationNames() {
  const snap = await db.collection('conversations').get();
  const updates = [];
  for (const doc of snap.docs) {
    scanned++;
    const names = doc.get('participantNames');
    if (!names || typeof names !== 'object') continue;
    let dirty = false;
    const next = {};
    for (const [uid, name] of Object.entries(names)) {
      if (looksLikeEmail(name)) {
        next[uid] = FALLBACK_NAME;
        dirty = true;
        console.log(`  [conversations] ${doc.ref.path}.participantNames.${uid}: "${name}" -> "${FALLBACK_NAME}"`);
      } else {
        next[uid] = name;
      }
    }
    if (dirty) {
      wouldChange++;
      updates.push({ ref: doc.ref, data: { participantNames: next } });
    }
  }
  await flushUpdates(updates);
  console.log(`[conversations] scanned ${snap.size}, matched ${updates.length}`);
}

async function main() {
  console.log(`\n=== Email-name scrub — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'} ===\n`);

  await scrubStringField('publicCatches', db.collection('publicCatches'), 'ownerName');
  await scrubStringField('posts', db.collection('posts'), 'ownerName');
  await scrubStringField('tournaments', db.collection('tournaments'), 'hostName');
  await scrubStringField('photoEntries', db.collectionGroup('photoEntries'), 'ownerName');
  await scrubStringField('feedPosts', db.collectionGroup('feedPosts'), 'ownerName');
  await scrubConversationNames();

  console.log(`\n=== Done. Scanned ${scanned} docs; ${wouldChange} carried an email name.`);
  if (APPLY) {
    console.log(`Wrote ${changed} updates.`);
  } else {
    console.log(`Dry run — nothing written. Re-run with --apply to scrub.`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('scrubEmailNames failed:', e);
  process.exit(1);
});
