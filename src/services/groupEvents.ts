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
  setDoc,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { requireFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';

export type RsvpStatus = 'going' | 'maybe' | 'not_going';

export type GroupEvent = {
  id: string;
  groupId: string;
  title: string;
  description?: string;
  /** ISO datetime of when the event happens. */
  dateIso: string;
  location?: { latitude?: number; longitude?: number; name?: string };
  createdBy: string;
  createdByName: string;
  /** ISO of creation time. */
  createdAt: string;
  rsvpCounts: { going: number; maybe: number; not_going: number };
};

export type EventRsvp = {
  uid: string;
  displayName: string;
  status: RsvpStatus;
  updatedAt: string;
};

function docToEvent(groupId: string, id: string, d: DocumentData): GroupEvent {
  return {
    id,
    groupId,
    title: String(d.title ?? '').slice(0, 200),
    description: typeof d.description === 'string' && d.description.length > 0 ? d.description : undefined,
    dateIso: String(d.dateIso ?? ''),
    location: d.location && typeof d.location === 'object'
      ? {
          latitude: typeof d.location.latitude === 'number' ? d.location.latitude : undefined,
          longitude: typeof d.location.longitude === 'number' ? d.location.longitude : undefined,
          name: typeof d.location.name === 'string' ? d.location.name : undefined,
        }
      : undefined,
    createdBy: String(d.createdBy ?? ''),
    createdByName: String(d.createdByName ?? 'Рибар'),
    createdAt: d.createdAt?.toMillis ? new Date(d.createdAt.toMillis()).toISOString() : '',
    rsvpCounts: {
      going: Number(d.rsvpCounts?.going ?? 0),
      maybe: Number(d.rsvpCounts?.maybe ?? 0),
      not_going: Number(d.rsvpCounts?.not_going ?? 0),
    },
  };
}

export async function createEvent(
  groupId: string,
  input: {
    title: string;
    description?: string;
    dateIso: string;
    location?: { latitude?: number; longitude?: number; name?: string };
    locationName?: string;
  },
  creator: { uid: string; displayName: string },
): Promise<string> {
  const fb = requireFirebase();
  // Allow callers to pass either a full location object or a free-text
  // locationName — the latter is what the simple "Ново събитие" form collects.
  const location = input.location
    ?? (input.locationName?.trim() ? { name: input.locationName.trim() } : undefined);
  const payload = stripUndefinedForFirestore({
    title: input.title.trim().slice(0, 200),
    description: input.description?.trim().slice(0, 2000) || undefined,
    dateIso: input.dateIso,
    location,
    createdBy: creator.uid,
    createdByName: creator.displayName.slice(0, 120) || 'Рибар',
    createdAt: serverTimestamp(),
    rsvpCounts: { going: 0, maybe: 0, not_going: 0 },
  });
  const ref = await addDoc(collection(fb.db, 'groups', groupId, 'events'), payload);
  return ref.id;
}

export async function getUpcomingEvents(groupId: string, maxCount = 40): Promise<GroupEvent[]> {
  const fb = requireFirebase();
  const snap = await getDocs(
    query(
      collection(fb.db, 'groups', groupId, 'events'),
      orderBy('dateIso', 'desc'),
      limit(maxCount),
    ),
  );
  return snap.docs.map((d) => docToEvent(groupId, d.id, d.data()));
}

export async function getEvent(groupId: string, eventId: string): Promise<GroupEvent | null> {
  const fb = requireFirebase();
  const snap = await getDoc(doc(fb.db, 'groups', groupId, 'events', eventId));
  if (!snap.exists()) return null;
  return docToEvent(groupId, eventId, snap.data());
}

export async function deleteEvent(groupId: string, eventId: string): Promise<void> {
  const fb = requireFirebase();
  await deleteDoc(doc(fb.db, 'groups', groupId, 'events', eventId));
}

/**
 * Sets the current user's RSVP. Maintains rsvpCounts on the event doc by
 * comparing the previous status (read in a tiny pre-read) against the new one.
 */
export async function setRsvp(
  groupId: string,
  eventId: string,
  user: { uid: string; displayName: string },
  status: RsvpStatus,
): Promise<void> {
  const fb = requireFirebase();
  const rsvpRef = doc(fb.db, 'groups', groupId, 'events', eventId, 'rsvps', user.uid);
  const eventRef = doc(fb.db, 'groups', groupId, 'events', eventId);
  const previous = await getDoc(rsvpRef);
  const prevStatus = previous.exists() ? (previous.data()?.status as RsvpStatus | undefined) : undefined;
  if (prevStatus === status) return;

  const batch = writeBatch(fb.db);
  batch.set(
    rsvpRef,
    stripUndefinedForFirestore({
      uid: user.uid,
      displayName: user.displayName.slice(0, 120) || 'Рибар',
      status,
      updatedAt: serverTimestamp(),
    }),
  );
  const patch: Record<string, unknown> = {};
  patch[`rsvpCounts.${status}`] = increment(1);
  if (prevStatus) patch[`rsvpCounts.${prevStatus}`] = increment(-1);
  batch.update(eventRef, patch);
  await batch.commit();
}

export async function getMyRsvp(
  groupId: string,
  eventId: string,
  uid: string,
): Promise<RsvpStatus | null> {
  const fb = requireFirebase();
  const snap = await getDoc(doc(fb.db, 'groups', groupId, 'events', eventId, 'rsvps', uid));
  if (!snap.exists()) return null;
  return (snap.data()?.status as RsvpStatus | undefined) ?? null;
}

export async function getEventRsvps(groupId: string, eventId: string): Promise<EventRsvp[]> {
  const fb = requireFirebase();
  const snap = await getDocs(collection(fb.db, 'groups', groupId, 'events', eventId, 'rsvps'));
  return snap.docs.map((d) => {
    const data = d.data() as { displayName?: string; status?: RsvpStatus; updatedAt?: { toMillis?: () => number } };
    return {
      uid: d.id,
      displayName: data.displayName ?? 'Рибар',
      status: (data.status ?? 'going') as RsvpStatus,
      updatedAt: data.updatedAt?.toMillis ? new Date(data.updatedAt.toMillis()).toISOString() : '',
    };
  });
}
