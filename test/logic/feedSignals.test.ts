import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory AsyncStorage stand-in, hoisted so the vi.mock factory can close
// over it before the module under test imports the real package.
const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => { store.set(k, v); },
    removeItem: async (k: string) => { store.delete(k); },
  },
}));

const KEY = '@ribolov/feedSignals';

type Mod = typeof import('../../src/services/feedSignals');
let mod: Mod;

// Fresh module each test so the module-level `cached` singleton resets.
beforeEach(async () => {
  store.clear();
  vi.resetModules();
  mod = await import('../../src/services/feedSignals');
});

describe('feedSignals', () => {
  it('returns an empty, versioned shape when nothing is stored', async () => {
    const s = await mod.loadFeedSignals();
    expect(s.v).toBe(1);
    expect(s.hiddenAuthorUids).toEqual([]);
    expect(s.notInterestedCatchIds).toEqual([]);
    expect(s.dwellByAuthorUid).toEqual({});
  });

  it('falls back to empty when the stored version mismatches', async () => {
    store.set(KEY, JSON.stringify({ v: 999, hiddenAuthorUids: ['x'] }));
    const s = await mod.loadFeedSignals();
    expect(s.v).toBe(1);
    expect(s.hiddenAuthorUids).toEqual([]);
  });

  it('hideAuthor adds once (idempotent); unhideAuthor removes', async () => {
    await mod.hideAuthor('bob');
    const after = await mod.hideAuthor('bob'); // no duplicate
    expect(after.hiddenAuthorUids).toEqual(['bob']);
    const un = await mod.unhideAuthor('bob');
    expect(un.hiddenAuthorUids).toEqual([]);
  });

  it('hideAuthor enforces the 500-entry LRU cap, dropping the oldest', async () => {
    for (let i = 0; i < 501; i++) await mod.hideAuthor(`u${i}`);
    const s = mod.readCachedSignals()!;
    expect(s.hiddenAuthorUids).toHaveLength(500);
    expect(s.hiddenAuthorUids).not.toContain('u0'); // oldest evicted
    expect(s.hiddenAuthorUids).toContain('u500');   // newest kept
  });

  it('markNotInterested adds once and dedups', async () => {
    await mod.markNotInterested('c1');
    const s = await mod.markNotInterested('c1');
    expect(s.notInterestedCatchIds).toEqual(['c1']);
  });

  it('recordDwell ignores sub-0.2s blips and accumulates real dwell', async () => {
    await mod.recordDwell({ bob: 0.1, alice: 3 }); // bob ignored
    const s = await mod.recordDwell({ alice: 2 });  // alice 3 -> 5
    expect(s.dwellByAuthorUid.bob).toBeUndefined();
    expect(s.dwellByAuthorUid.alice).toBeCloseTo(5, 5);
  });

  it('recordDwell caps the per-call delta at +60s', async () => {
    const s = await mod.recordDwell({ alice: 5000 });
    expect(s.dwellByAuthorUid.alice).toBe(60); // prev 0 + min(5000, 60)
  });

  it('recordDwell prunes to the top-200 authors by score', async () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 250; i++) big[`u${i}`] = i + 1; // ascending scores
    const s = await mod.recordDwell(big);
    expect(Object.keys(s.dwellByAuthorUid)).toHaveLength(200);
    expect(s.dwellByAuthorUid.u249).toBeDefined(); // highest score kept
    expect(s.dwellByAuthorUid.u0).toBeUndefined();  // lowest score pruned
  });

  it('applies ~7-day half-life decay to dwell on load', async () => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    store.set(KEY, JSON.stringify({
      v: 1,
      hiddenAuthorUids: [],
      notInterestedCatchIds: [],
      dwellByAuthorUid: { bob: 10 },
      dwellLastUpdatedAt: sevenDaysAgo,
    }));
    const s = await mod.loadFeedSignals();
    expect(s.dwellByAuthorUid.bob).toBeCloseTo(5, 0); // halved after one half-life
  });

  it('readCachedSignals is null before hydrate, populated after', async () => {
    expect(mod.readCachedSignals()).toBeNull();
    await mod.loadFeedSignals();
    expect(mod.readCachedSignals()).not.toBeNull();
  });
});
