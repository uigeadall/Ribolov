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
  await setDoc(doc(fb.db, 'groups', id), {
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
  await setDoc(doc(fb.db, 'groups', id, 'members', creator.uid), {
    uid: creator.uid,
    displayName: creator.displayName,
    role: 'admin',
    joinedAt: serverTimestamp(),
  });
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
  try {
    // Fast path: collectionGroup query works for members created after the uid field was added
    const memberSnap = await getDocs(
      query(collectionGroup(fb.db, 'members'), where('uid', '==', uid))
    );
    let groupIds = memberSnap.docs.map((d) => d.ref.parent.parent!.id);

    // Fallback for legacy member documents that pre-date the uid field:
    // check the user's direct member document path across all groups.
    if (groupIds.length === 0) {
      const allSnap = await getDocs(collection(fb.db, 'groups'));
      const checks = await Promise.all(
        allSnap.docs.map((d) => getDoc(doc(fb.db, 'groups', d.id, 'members', uid)))
      );
      groupIds = allSnap.docs.filter((_, i) => checks[i].exists()).map((d) => d.id);
    }

    const unique = [...new Set(groupIds)];
    const groups = await Promise.all(unique.map((id) => getGroup(id)));
    return groups.filter((g): g is Group => g !== null);
  } catch {
    return [];
  }
}

export async function getGroup(groupId: string): Promise<Group | null> {
  const fb = requireFirebase();
  const snap = await getDoc(doc(fb.db, 'groups', groupId));
  if (!snap.exists()) return null;
  return docToGroup(snap.id, snap.data());
}

export async function joinGroup(groupId: string, user: { uid: string; displayName: string }): Promise<void> {
  const fb = requireFirebase();
  await setDoc(doc(fb.db, 'groups', groupId, 'members', user.uid), {
    uid: user.uid,
    displayName: user.displayName,
    role: 'member',
    joinedAt: serverTimestamp(),
  });
  // Best-effort counter — membership write above is the authoritative join
  await updateDoc(doc(fb.db, 'groups', groupId), { memberCount: increment(1) }).catch(() => {});
}

export async function leaveGroup(groupId: string, uid: string): Promise<void> {
  const fb = requireFirebase();
  await deleteDoc(doc(fb.db, 'groups', groupId, 'members', uid));
  // Best-effort counter
  await updateDoc(doc(fb.db, 'groups', groupId), { memberCount: increment(-1) }).catch(() => {});
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
