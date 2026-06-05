import { describe, it, expect } from 'vitest';
import { selectTodayCard, GOOD_FISHING_THRESHOLD, type TodaySignals } from '../../src/screens/home/selectTodayCard';

const NOW = new Date('2026-06-04T12:00:00.000Z');
const todayIso = '2026-06-04T08:00:00.000Z';
const oldIso = '2026-05-01T08:00:00.000Z';

function signals(over: Partial<TodaySignals> = {}): TodaySignals {
  return { followingCatches: [], fishingRating: null, nearestSpotName: null, now: NOW, ...over };
}

describe('selectTodayCard', () => {
  it('prefers social when a followed angler posted today', () => {
    const card = selectTodayCard(signals({
      followingCatches: [{ ownerUid: 'u1', ownerName: 'Иван', date: todayIso }],
      fishingRating: 5, // even with great weather, social wins
    }));
    expect(card).toEqual({ kind: 'social', actorName: 'Иван', othersCount: 0 });
  });

  it('counts distinct other owners for the social card', () => {
    const card = selectTodayCard(signals({
      followingCatches: [
        { ownerUid: 'u1', ownerName: 'Иван', date: todayIso },
        { ownerUid: 'u1', ownerName: 'Иван', date: todayIso }, // same owner, not counted twice
        { ownerUid: 'u2', ownerName: 'Петър', date: todayIso },
      ],
    }));
    expect(card).toEqual({ kind: 'social', actorName: 'Иван', othersCount: 1 });
  });

  it('falls back to Рибар when the first today-owner has no name', () => {
    const card = selectTodayCard(signals({
      followingCatches: [{ ownerUid: 'u1', date: todayIso }],
    }));
    expect(card).toEqual({ kind: 'social', actorName: 'Рибар', othersCount: 0 });
  });

  it('ignores following catches from other days', () => {
    const card = selectTodayCard(signals({
      followingCatches: [{ ownerUid: 'u1', ownerName: 'Иван', date: oldIso }],
      fishingRating: 2,
    }));
    expect(card.kind).toBe('baseline');
  });

  it('shows good conditions when rating >= threshold and no social', () => {
    const card = selectTodayCard(signals({ fishingRating: GOOD_FISHING_THRESHOLD, nearestSpotName: 'Язовир Искър' }));
    expect(card).toEqual({ kind: 'conditions', rating: GOOD_FISHING_THRESHOLD, spotName: 'Язовир Искър' });
  });

  it('shows baseline when rating is below threshold', () => {
    const card = selectTodayCard(signals({ fishingRating: 3, nearestSpotName: 'Язовир Искър' }));
    expect(card).toEqual({ kind: 'baseline', rating: 3, spotName: 'Язовир Искър' });
  });

  it('shows baseline when there is no weather rating at all', () => {
    const card = selectTodayCard(signals({ fishingRating: null }));
    expect(card).toEqual({ kind: 'baseline', rating: null, spotName: null });
  });
});
