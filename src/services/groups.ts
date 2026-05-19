import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  increment,
  writeBatch,
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { newId } from '../storage/storage';

export type GroupCategory = 'club' | 'water' | 'species' | 'general';

export const CATEGORY_LABELS: Record<GroupCategory, string> = {
  club: 'Риболовен клуб',
  water: 'По водоем',
  species: 'По вид риба',
  general: 'Общо',
};

export type Group = {
  id: string;
  name: string;
  description?: string;
  category: GroupCategory;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  memberCount: number;
  postCount: number;
};

export type GroupPost = {
  id: string;
  text: string;
  ownerUid: string;
  ownerName: string;
  createdAt: string;
};

export type GroupMember = {
  uid: string;
  displayName: string;
  role: 'admin' | 'member';
  joinedAt: string;
};

/* ─── Groups ─────────────────────────────────────────────── */

export async function createGroup(
  g: Pick<Group, 'name' | 'description' | 'category'>,
  creator: { uid: string; displayName: string }
): Promise<string> {
  const fb = requireFirebase();
  const id = newId();
  const batch = writeBatch(fb.db);
  batch.set(doc(fb.db, 'groups', id), {
    name: g.name.trim(),
    description: g.description?.trim() ?? '',
    category: g.category,
    createdBy: creator.uid,
    createdByName: creator.displayName,
    createdAt: serverTimestamp(),
    memberCount: 1,
    postCount: 0,
  });
  // Creator becomes admin member — uid stored explicitly for collectionGroup queries
  batch.set(doc(fb.db, 'groups', id, 'members', creator.uid), {
    uid: creator.uid,
    displayName: creator.displayName,
    role: 'admin',
    joinedAt: serverTimestamp(),
  });
  // Mirror membership under the user's own doc so fetchMyGroups can read it
  // directly without a collectionGroup index. Without this mirror, listing
  // "Моите клубове" required an index that may not be deployed/built yet.
  batch.set(doc(fb.db, 'users', creator.uid, 'groupMemberships', id), {
    groupId: id,
    joinedAt: serverTimestamp(),
  });
  await batch.commit();
  return id;
}

export async function fetchGroups(maxCount = 30): Promise<Group[]> {
  const fb = requireFirebase();
  const snap = await getDocs(
    query(collection(fb.db, 'groups'), orderBy('memberCount', 'desc'), limit(maxCount))
  );
  return snap.docs.map((d) => docToGroup(d.id, d.data()));
}

export async function fetchMyGroups(uid: string): Promise<Group[]> {
  const fb = requireFirebase();

  // Primary path: read the user's own membership mirror. This avoids the need
  // for a collectionGroup index and is O(1) regardless of total group count.
  const groupIds = new Set<string>();
  try {
    const snap = await getDocs(collection(fb.db, 'users', uid, 'groupMemberships'));
    snap.docs.forEach((d) => groupIds.add(d.id));
  } catch { /* ignore — fall through to legacy paths */ }

  // Backfill: pre-mirror users may still only have docs under groups/{id}/members/{uid}.
  // Try the collectionGroup query when the mirror is empty; succeeds only if the
  // composite index is built.
  if (groupIds.size === 0) {
    try {
      const memberSnap = await getDocs(
        query(collectionGroup(fb.db, 'members'), where('uid', '==', uid))
      );
      memberSnap.docs.forEach((d) => {
        const parent = d.ref.parent.parent;
        if (parent) groupIds.add(parent.id);
      });
    } catch { /* index missing — fall through */ }
  }

  // Last-resort fallback: scan all groups and check each for our membership doc.
  // Slow on large /groups collections but correct.
  if (groupIds.size === 0) {
    try {
      const allSnap = await getDocs(collection(fb.db, 'groups'));
      const checks = await Promise.all(
        allSnap.docs.map((d) => getDoc(doc(fb.db, 'groups', d.id, 'members', uid)).catch(() => null))
      );
      allSnap.docs.forEach((d, i) => {
        if (checks[i]?.exists()) groupIds.add(d.id);
      });
    } catch { /* return whatever we have */ }
  }

  if (groupIds.size === 0) return [];

  const ids = [...groupIds];
  // Use individual try/catch per group so one missing/deleted doc doesn't drop the whole list.
  const groups = await Promise.all(ids.map((id) => getGroup(id).catch(() => null)));
  return groups.filter((g): g is Group => g !== null);
}

export async function getGroup(groupId: string): Promise<Group | null> {
  const fb = requireFirebase();
  const snap = await getDoc(doc(fb.db, 'groups', groupId));
  if (!snap.exists()) return null;
  return docToGroup(snap.id, snap.data());
}

export async function joinGroup(groupId: string, user: { uid: string; displayName: string }): Promise<void> {
  const fb = requireFirebase();
  const batch = writeBatch(fb.db);
  batch.set(doc(fb.db, 'groups', groupId, 'members', user.uid), {
    uid: user.uid,
    displayName: user.displayName,
    role: 'member',
    joinedAt: serverTimestamp(),
  });
  batch.set(doc(fb.db, 'users', user.uid, 'groupMemberships', groupId), {
    groupId,
    joinedAt: serverTimestamp(),
  });
  batch.update(doc(fb.db, 'groups', groupId), { memberCount: increment(1) });
  await batch.commit();
}

export async function leaveGroup(groupId: string, uid: string): Promise<void> {
  const fb = requireFirebase();
  const batch = writeBatch(fb.db);
  batch.delete(doc(fb.db, 'groups', groupId, 'members', uid));
  batch.delete(doc(fb.db, 'users', uid, 'groupMemberships', groupId));
  batch.update(doc(fb.db, 'groups', groupId), { memberCount: increment(-1) });
  await batch.commit();
}

export async function isMember(groupId: string, uid: string): Promise<boolean> {
  const fb = requireFirebase();
  const snap = await getDoc(doc(fb.db, 'groups', groupId, 'members', uid));
  return snap.exists();
}

export async function getMembers(groupId: string): Promise<GroupMember[]> {
  const fb = requireFirebase();
  const snap = await getDocs(collection(fb.db, 'groups', groupId, 'members'));
  return snap.docs.map((d) => {
    const data = d.data() as { displayName?: string; role?: string; joinedAt?: { toMillis?: () => number } };
    return {
      uid: d.id,
      displayName: data.displayName ?? 'Рибар',
      role: (data.role ?? 'member') as 'admin' | 'member',
      joinedAt: data.joinedAt?.toMillis ? new Date(data.joinedAt.toMillis()).toISOString() : '',
    };
  });
}

/* ─── Group Posts ─────────────────────────────────────────── */

export async function postToGroup(
  groupId: string,
  text: string,
  author: { uid: string; displayName: string }
): Promise<void> {
  const fb = requireFirebase();
  await addDoc(collection(fb.db, 'groups', groupId, 'posts'), {
    text: text.trim().slice(0, 2000),
    ownerUid: author.uid,
    ownerName: author.displayName,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(fb.db, 'groups', groupId), { postCount: increment(1) });
}

export async function deleteGroupPost(groupId: string, postId: string): Promise<void> {
  const fb = requireFirebase();
  await deleteDoc(doc(fb.db, 'groups', groupId, 'posts', postId));
  await updateDoc(doc(fb.db, 'groups', groupId), { postCount: increment(-1) }).catch(() => {});
}

export async function getGroupPosts(groupId: string, maxCount = 40): Promise<GroupPost[]> {
  const fb = requireFirebase();
  const snap = await getDocs(
    query(collection(fb.db, 'groups', groupId, 'posts'), orderBy('createdAt', 'desc'), limit(maxCount))
  );
  return snap.docs.map((d) => {
    const data = d.data() as { text: string; ownerUid: string; ownerName: string; createdAt?: { toMillis?: () => number } };
    return {
      id: d.id,
      text: data.text,
      ownerUid: data.ownerUid,
      ownerName: data.ownerName,
      createdAt: data.createdAt?.toMillis ? new Date(data.createdAt.toMillis()).toISOString() : '',
    };
  });
}

function docToGroup(id: string, data: Record<string, unknown>): Group {
  const d = data as {
    name?: string; description?: string; category?: string;
    createdBy?: string; createdByName?: string;
    memberCount?: number; postCount?: number;
    createdAt?: { toMillis?: () => number };
  };
  return {
    id,
    name: String(d.name ?? ''),
    description: d.description ? String(d.description) : undefined,
    category: (d.category ?? 'general') as GroupCategory,
    createdBy: String(d.createdBy ?? ''),
    createdByName: String(d.createdByName ?? 'Рибар'),
    memberCount: Number(d.memberCount ?? 0),
    postCount: Number(d.postCount ?? 0),
    createdAt: d.createdAt?.toMillis ? new Date(d.createdAt.toMillis()).toISOString() : '',
  };
}
