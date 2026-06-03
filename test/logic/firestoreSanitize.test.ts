import { describe, it, expect } from 'vitest';
import { serverTimestamp, deleteField, Timestamp, FieldValue } from 'firebase/firestore';
import { stripUndefinedForFirestore } from '../../src/services/firestoreSanitize';

describe('stripUndefinedForFirestore', () => {
  it('drops top-level undefined keys', () => {
    const out = stripUndefinedForFirestore({ a: 1, b: undefined, c: 'x' });
    expect(out).toEqual({ a: 1, c: 'x' });
    expect('b' in out).toBe(false);
  });

  it('preserves null, 0, empty string, and false', () => {
    const out = stripUndefinedForFirestore({ a: null, b: 0, c: '', d: false });
    expect(out).toEqual({ a: null, b: 0, c: '', d: false });
  });

  it('recurses into nested objects', () => {
    const out = stripUndefinedForFirestore({ outer: { keep: 1, drop: undefined } });
    expect(out).toEqual({ outer: { keep: 1 } });
  });

  it('maps arrays and filters undefined elements', () => {
    const out = stripUndefinedForFirestore({ list: [1, undefined, 2] });
    expect(out).toEqual({ list: [1, 2] });
  });

  it('preserves FieldValue sentinels as opaque leaves', () => {
    const out = stripUndefinedForFirestore({ ts: serverTimestamp(), del: deleteField() });
    expect(out.ts).toBeInstanceOf(FieldValue);
    expect(out.del).toBeInstanceOf(FieldValue);
  });

  it('preserves Timestamp instances as opaque leaves', () => {
    const ts = Timestamp.fromMillis(1_700_000_000_000);
    const out = stripUndefinedForFirestore({ when: ts });
    expect(out.when).toBe(ts);
    expect(out.when).toBeInstanceOf(Timestamp);
  });
});
