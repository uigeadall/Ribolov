import { describe, it, expect } from 'vitest';
import { scoreFeedItem, rankFeedItems, type RankingSignals } from '../../src/services/feedRanking';
import type { FeedItem } from '../../src/services/catchSync';

// Minimal FeedItem factory — only the fields scoreFeedItem reads.
function item(over: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'c1',
    speciesId: 'sp1',
    speciesName: 'Костур',
    date: new Date().toISOString(),
    ownerUid: 'bob',
    ...over,
  } as FeedItem;
}

function signals(over: Partial<RankingSignals> = {}): RankingSignals {
  return {
    followedUids: new Set<string>(),
    favoriteSpotCoords: [],
    topSpeciesIds: new Set<string>(),
    myUid: 'me',
    ...over,
  };
}

describe('scoreFeedItem', () => {
  it('hides my own catches with -Infinity', () => {
    expect(scoreFeedItem(item({ ownerUid: 'me' }), signals({ myUid: 'me' }))).toBe(-Infinity);
  });

  it('drops hidden authors with -Infinity', () => {
    const s = signals({ hiddenAuthorUids: new Set(['bob']) });
    expect(scoreFeedItem(item({ ownerUid: 'bob' }), s)).toBe(-Infinity);
  });

  it('drops not-interested catch ids with -Infinity', () => {
    const s = signals({ notInterestedCatchIds: new Set(['c1']) });
    expect(scoreFeedItem(item({ id: 'c1' }), s)).toBe(-Infinity);
  });

  it('scores a followed author higher than a non-followed one (same recency)', () => {
    const date = new Date().toISOString();
    const followed = scoreFeedItem(item({ ownerUid: 'bob', date }), signals({ followedUids: new Set(['bob']) }));
    const plain = scoreFeedItem(item({ ownerUid: 'bob', date }), signals());
    expect(followed).toBeGreaterThan(plain);
  });

  it('scores a fresher catch higher than an older one (all else equal)', () => {
    const fresh = scoreFeedItem(item({ date: new Date().toISOString() }), signals());
    const old = scoreFeedItem(item({ date: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString() }), signals());
    expect(fresh).toBeGreaterThan(old);
  });
});

describe('rankFeedItems', () => {
  it('returns [] for empty input', () => {
    expect(rankFeedItems([], signals())).toEqual([]);
  });

  it('excludes hidden items and sorts the rest by descending score', () => {
    const fresh = item({ id: 'fresh', ownerUid: 'bob', date: new Date().toISOString() });
    const old = item({ id: 'old', ownerUid: 'bob', date: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString() });
    const hidden = item({ id: 'hidden', ownerUid: 'carol' });
    const out = rankFeedItems([old, hidden, fresh], signals({ hiddenAuthorUids: new Set(['carol']) }));
    expect(out.map((i) => i.id)).toEqual(['fresh', 'old']);
  });
});
