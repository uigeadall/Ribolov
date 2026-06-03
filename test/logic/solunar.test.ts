import { describe, it, expect } from 'vitest';
import { getSolunarDay } from '../../src/services/solunar';

const PHASES = [
  'new', 'waxingCrescent', 'firstQuarter', 'waxingGibbous',
  'full', 'waningGibbous', 'lastQuarter', 'waningCrescent',
];

// Sofia-ish coordinates; date is fixed so the test is deterministic.
const LAT = 42.7;
const LON = 23.3;
const REF = new Date('2024-01-11T12:00:00.000Z'); // near a new moon

describe('getSolunarDay', () => {
  it('returns illumination within 0..1', () => {
    const d = getSolunarDay(LAT, LON, REF);
    expect(d.illumination).toBeGreaterThanOrEqual(0);
    expect(d.illumination).toBeLessThanOrEqual(1);
  });

  it('returns ageDays within the synodic month', () => {
    const d = getSolunarDay(LAT, LON, REF);
    expect(d.ageDays).toBeGreaterThanOrEqual(0);
    expect(d.ageDays).toBeLessThanOrEqual(29.6);
  });

  it('returns a known phase name and a 1..5 rating', () => {
    const d = getSolunarDay(LAT, LON, REF);
    expect(PHASES).toContain(d.phaseName);
    expect([1, 2, 3, 4, 5]).toContain(d.rating);
  });

  it('returns periods sorted ascending by start time', () => {
    const { periods } = getSolunarDay(LAT, LON, REF);
    // SolunarPeriod.startIso is an ISO string — ISO strings are lexicographically
    // sortable, so localeCompare is equivalent to numeric time ordering here.
    const starts = periods.map((p) => p.startIso);
    const sorted = [...starts].sort((a, b) => a.localeCompare(b));
    expect(starts).toEqual(sorted);
  });

  it('is deterministic for the same date and coordinates', () => {
    const a = getSolunarDay(LAT, LON, REF);
    const b = getSolunarDay(LAT, LON, REF);
    expect(a).toEqual(b);
  });

  it('produces different illumination ~half a cycle apart', () => {
    const a = getSolunarDay(LAT, LON, REF);
    const b = getSolunarDay(LAT, LON, new Date('2024-01-25T12:00:00.000Z'));
    expect(Math.abs(a.illumination - b.illumination)).toBeGreaterThan(0.3);
  });
});
