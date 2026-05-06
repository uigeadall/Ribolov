import { FieldValue, Timestamp } from 'firebase/firestore';

function preserveFirestoreLeaf(v: unknown): boolean {
  return v instanceof FieldValue || v instanceof Timestamp;
}

/**
 * Firestore отхвърля полета със стойност `undefined`.
 * Премахва ги рекурсивно; запазва FieldValue (serverTimestamp, deleteField …) и Timestamp.
 */
export function stripUndefinedForFirestore(input: Record<string, unknown>): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (v === undefined) return undefined;
    if (preserveFirestoreLeaf(v)) return v;
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk).filter((x) => x !== undefined);
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(obj)) {
      const next = walk(val);
      if (next !== undefined) out[k] = next;
    }
    return out;
  };
  return walk(input) as Record<string, unknown>;
}
