import { describe, it, expect } from 'vitest';
import {
  computePersonalBests,
  isPersonalBestCatch,
  checkNewPersonalBest,
} from '../../src/services/personalBests';
import type { Catch } from '../../src/types/index';

function c(over: Partial<Catch> = {}): Catch {
  return {
    id: 'id',
    speciesId: 'sp1',
    speciesName: 'Шаран',
    date: '2024-05-01T00:00:00.000Z',
    ...over,
  } as Catch;
}

describe('computePersonalBests', () => {
  it('seeds the PB from the first qualifying catch', () => {
    const bests = computePersonalBests([c({ id: 'a', weightKg: 2, lengthCm: 40 })]);
    const pb = bests.get('sp1')!;
    expect(pb.weightKg).toBe(2);
    expect(pb.catchId).toBe('a');
    expect(pb.weightCatchId).toBe('a');
    expect(pb.lengthCatchId).toBe('a');
  });

  it('lets a heavier catch overtake the weight record', () => {
    const bests = computePersonalBests([
      c({ id: 'a', weightKg: 2, lengthCm: 40 }),
      c({ id: 'b', weightKg: 5, lengthCm: 30 }),
    ]);
    const pb = bests.get('sp1')!;
    expect(pb.weightKg).toBe(5);
    expect(pb.weightCatchId).toBe('b');
    expect(pb.catchId).toBe('b');
  });

  it('tracks weight and length records on different catches independently', () => {
    const bests = computePersonalBests([
      c({ id: 'heavy', weightKg: 9, lengthCm: 20 }),
      c({ id: 'long', weightKg: 1, lengthCm: 80 }),
    ]);
    const pb = bests.get('sp1')!;
    expect(pb.weightCatchId).toBe('heavy');
    expect(pb.lengthCatchId).toBe('long');
  });

  it('skips catches with no weight and no length', () => {
    const bests = computePersonalBests([c({ id: 'empty' })]);
    expect(bests.has('sp1')).toBe(false);
  });
});

describe('isPersonalBestCatch', () => {
  it('is true for a catch holding either dimension record', () => {
    const catches = [
      c({ id: 'heavy', weightKg: 9, lengthCm: 20 }),
      c({ id: 'long', weightKg: 1, lengthCm: 80 }),
    ];
    const bests = computePersonalBests(catches);
    expect(isPersonalBestCatch(catches[0], bests)).toBe(true); // weight holder
    expect(isPersonalBestCatch(catches[1], bests)).toBe(true); // length holder
  });

  it('is false for a non-record catch', () => {
    const catches = [
      c({ id: 'best', weightKg: 9, lengthCm: 80 }),
      c({ id: 'mid', weightKg: 3, lengthCm: 30 }),
    ];
    const bests = computePersonalBests(catches);
    expect(isPersonalBestCatch(catches[1], bests)).toBe(false);
  });
});

describe('checkNewPersonalBest', () => {
  const prior = [c({ id: 'p', weightKg: 4, lengthCm: 50 })];

  it('reports "both" when the new catch beats weight and length', () => {
    expect(checkNewPersonalBest(c({ id: 'n', weightKg: 5, lengthCm: 60 }), prior))
      .toEqual({ isNew: true, field: 'both' });
  });

  it('reports "weight" when only weight is beaten', () => {
    expect(checkNewPersonalBest(c({ id: 'n', weightKg: 5, lengthCm: 10 }), prior))
      .toEqual({ isNew: true, field: 'weight' });
  });

  it('reports "length" when only length is beaten', () => {
    expect(checkNewPersonalBest(c({ id: 'n', weightKg: 1, lengthCm: 60 }), prior))
      .toEqual({ isNew: true, field: 'length' });
  });

  it('reports not-new when neither dimension is beaten', () => {
    expect(checkNewPersonalBest(c({ id: 'n', weightKg: 4, lengthCm: 50 }), prior))
      .toEqual({ isNew: false, field: null });
  });
});
