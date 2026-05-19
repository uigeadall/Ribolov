import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';

export type GroupPoll = {
  id: string;
  groupId: string;
  question: string;
  options: string[];
  voteCounts: number[];
  createdBy: string;
  createdByName: string;
  createdAt: string;
};

function docToPoll(groupId: string, id: string, d: DocumentData): GroupPoll {
  const opts = Array.isArray(d.options) ? (d.options as unknown[]).map((o) => String(o ?? '')) : [];
  // voteCounts is stored as a map keyed by stringified index so Firestore can
  // increment individual buckets via dot-notation (arrays don't support that).
  const rawCounts = (d.voteCounts && typeof d.voteCounts === 'object') ? d.voteCounts as Record<string, number> : {};
  const counts = opts.map((_, i) => Number(rawCounts[String(i)] ?? 0));
  return {
    id,
    groupId,
    question: String(d.question ?? '').slice(0, 280),
    options: opts,
    voteCounts: counts,
    createdBy: String(d.createdBy ?? ''),
    createdByName: String(d.createdByName ?? 'Рибар'),
    createdAt: d.createdAt?.toMillis ? new Date(d.createdAt.toMillis()).toISOString() : '',
  };
}

export async function createPoll(
  groupId: string,
  input: { question: string; options: string[] },
  creator: { uid: string; displayName: string },
): Promise<string> {
  const fb = requireFirebase();
  const cleanedOptions = input.options
    .map((o) => o.trim().slice(0, 80))
    .filter((o) => o.length > 0)
    .slice(0, 6);
  if (cleanedOptions.length < 2) {
    throw new Error('Анкетата трябва да има поне 2 варианта.');
  }
  const voteCounts: Record<string, number> = {};
  cleanedOptions.forEach((_, i) => { voteCounts[String(i)] = 0; });
  const payload = stripUndefinedForFirestore({
    question: input.question.trim().slice(0, 280),
    options: cleanedOptions,
    voteCounts,
    createdBy: creator.uid,
    createdByName: creator.displayName.slice(0, 120) || 'Рибар',
    createdAt: serverTimestamp(),
  });
  const ref = await addDoc(collection(fb.db, 'groups', groupId, 'polls'), payload);
  return ref.id;
}

export async function getPolls(groupId: string, maxCount = 30): Promise<GroupPoll[]> {
  const fb = requireFirebase();
  const snap = await getDocs(
    query(collection(fb.db, 'groups', groupId, 'polls'), orderBy('createdAt', 'desc'), limit(maxCount)),
  );
  return snap.docs.map((d) => docToPoll(groupId, d.id, d.data()));
}

export async function getMyVote(groupId: string, pollId: string, uid: string): Promise<number | null> {
  const fb = requireFirebase();
  const snap = await getDoc(doc(fb.db, 'groups', groupId, 'polls', pollId, 'votes', uid));
  if (!snap.exists()) return null;
  const idx = snap.data()?.optionIndex;
  return typeof idx === 'number' ? idx : null;
}

/**
 * Casts or changes a vote. Switching to a different option decrements the previous
 * bucket. Voting the same option again is a no-op (don't double-count or unset).
 */
export async function castVote(
  groupId: string,
  pollId: string,
  uid: string,
  optionIndex: number,
): Promise<void> {
  const fb = requireFirebase();
  const voteRef = doc(fb.db, 'groups', groupId, 'polls', pollId, 'votes', uid);
  const pollRef = doc(fb.db, 'groups', groupId, 'polls', pollId);

  const [voteSnap, pollSnap] = await Promise.all([getDoc(voteRef), getDoc(pollRef)]);
  if (!pollSnap.exists()) throw new Error('Анкетата не съществува.');
  const opts = pollSnap.data()?.options as unknown[] | undefined;
  if (!Array.isArray(opts) || optionIndex < 0 || optionIndex >= opts.length) {
    throw new Error('Невалиден избор.');
  }
  const prevIdx = voteSnap.exists() ? (voteSnap.data()?.optionIndex as number | undefined) : undefined;
  if (prevIdx === optionIndex) return;

  const batch = writeBatch(fb.db);
  batch.set(voteRef, stripUndefinedForFirestore({
    optionIndex,
    votedAt: serverTimestamp(),
  }));
  const patch: Record<string, unknown> = {};
  patch[`voteCounts.${optionIndex}`] = increment(1);
  if (typeof prevIdx === 'number') patch[`voteCounts.${prevIdx}`] = increment(-1);
  batch.update(pollRef, patch);
  await batch.commit();
}

export async function deletePoll(groupId: string, pollId: string): Promise<void> {
  const fb = requireFirebase();
  await deleteDoc(doc(fb.db, 'groups', groupId, 'polls', pollId));
}
