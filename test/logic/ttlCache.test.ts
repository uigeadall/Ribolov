import { describe, expect, it } from 'vitest';
import { TtlMap } from '../../src/services/ttlCache';

describe('TtlMap', () => {
  it('returns a stored value before the TTL expires', () => {
    let now = 1000;
    const cache = new TtlMap<string, number>(500, () => now);
    cache.set('a', 42);
    now = 1499;
    expect(cache.get('a')).toBe(42);
  });

  it('expires a value once the TTL elapses', () => {
    let now = 1000;
    const cache = new TtlMap<string, number>(500, () => now);
    cache.set('a', 42);
    now = 1500;
    expect(cache.get('a')).toBeUndefined();
  });

  it('returns undefined for keys never set', () => {
    const cache = new TtlMap<string, number>(500);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('set refreshes the TTL window', () => {
    let now = 1000;
    const cache = new TtlMap<string, number>(500, () => now);
    cache.set('a', 1);
    now = 1400;
    cache.set('a', 2);
    now = 1899;
    expect(cache.get('a')).toBe(2);
  });

  it('delete removes an entry immediately', () => {
    const cache = new TtlMap<string, number>(500);
    cache.set('a', 1);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
  });

  it('stores falsy values distinctly from missing ones', () => {
    const cache = new TtlMap<string, boolean>(500);
    cache.set('a', false);
    expect(cache.get('a')).toBe(false);
  });
});
