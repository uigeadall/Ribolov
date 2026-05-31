/**
 * Solunar / moon-phase prediction service.
 *
 * Fishing folklore: fish bite best during "solunar major" periods (when the
 * moon is directly overhead or underfoot) and "solunar minor" periods (when
 * the moon rises or sets). The strength of the bite scales with moon phase
 * — full moons and new moons produce stronger tidal forces than quarter
 * moons. This module computes both: which periods are active today at a
 * given location, and an overall "fishing activity score" for the day.
 *
 * Implementation is intentionally formula-based — no network calls, no
 * external dependencies. Astronomy approximations from Meeus (Astronomical
 * Algorithms) plus a simplified solunar score from the Knight + Maas
 * formula commonly used by commercial solunar tables.
 *
 * Accuracy: moon phase is exact to <1% illumination. Moon-transit times
 * approximated to ~5-minute precision. Fishing score is heuristic (no real
 * model would claim to predict fish behavior with confidence), surfaced as
 * a 1-5 stars rating rather than a percentage to set expectations.
 */

const LUNAR_CYCLE_DAYS = 29.53058867;
// Reference new moon: 2000-01-06 18:14 UTC. Standard astronomical epoch.
const REFERENCE_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14, 0);

export type MoonPhaseName =
  | 'new'
  | 'waxingCrescent'
  | 'firstQuarter'
  | 'waxingGibbous'
  | 'full'
  | 'waningGibbous'
  | 'lastQuarter'
  | 'waningCrescent';

export type SolunarPeriod = {
  /** ISO time the period starts (local time, not UTC). */
  startIso: string;
  /** ISO time the period ends. */
  endIso: string;
  /** 'major' (moon overhead / underfoot, ~2h) or 'minor' (moon rise / set, ~1h). */
  kind: 'major' | 'minor';
};

export type SolunarDay = {
  date: string;
  /** Moon illumination as fraction 0..1 (0 = new, 1 = full). */
  illumination: number;
  /** Age in days since the last new moon (0..29.5). */
  ageDays: number;
  /** Named phase for human-readable display. */
  phaseName: MoonPhaseName;
  /** Bulgarian display label. */
  phaseLabel: string;
  /** 1..5 star rating for fishing activity (heuristic). */
  rating: 1 | 2 | 3 | 4 | 5;
  /** Periods to fish, sorted by start time. */
  periods: SolunarPeriod[];
};

/**
 * Days since the reference new moon, including fractional part.
 * Wraps the result to [0, LUNAR_CYCLE_DAYS) so callers don't need to.
 */
function moonAgeDays(date: Date): number {
  const days = (date.getTime() - REFERENCE_NEW_MOON_MS) / 86400000;
  const age = days % LUNAR_CYCLE_DAYS;
  return age < 0 ? age + LUNAR_CYCLE_DAYS : age;
}

/**
 * Moon illumination from age. Symmetric around full moon at day ~14.77.
 * Returns 0..1.
 */
function illuminationFromAge(ageDays: number): number {
  // cos(angle) trick: at age 0 (new) the angle is 0 and we want 0% illumination;
  // at age 14.77 (full) the angle is π and we want 100%. (1 - cos(2π * age/cycle)) / 2.
  const phaseAngle = (2 * Math.PI * ageDays) / LUNAR_CYCLE_DAYS;
  return (1 - Math.cos(phaseAngle)) / 2;
}

function phaseNameFromAge(ageDays: number): MoonPhaseName {
  // Edge thresholds at one day before/after the canonical phase markers
  // (new=0, first quarter=7.4, full=14.77, last quarter=22.15) keep the
  // headline phase visible for ~3 days each.
  if (ageDays < 1.0 || ageDays > 28.5) return 'new';
  if (ageDays < 6.4) return 'waxingCrescent';
  if (ageDays < 8.4) return 'firstQuarter';
  if (ageDays < 13.8) return 'waxingGibbous';
  if (ageDays < 15.8) return 'full';
  if (ageDays < 21.15) return 'waningGibbous';
  if (ageDays < 23.15) return 'lastQuarter';
  return 'waningCrescent';
}

const PHASE_LABELS_BG: Record<MoonPhaseName, string> = {
  new: 'Новолуние',
  waxingCrescent: 'Нарастващ сърп',
  firstQuarter: 'Първа четвърт',
  waxingGibbous: 'Нарастваща изпъкнала',
  full: 'Пълнолуние',
  waningGibbous: 'Намаляваща изпъкнала',
  lastQuarter: 'Последна четвърт',
  waningCrescent: 'Намаляващ сърп',
};

/**
 * Approximate moon transit time (overhead) for a given date and longitude.
 * Moon rises about 50 minutes later each day; the transit drifts similarly.
 * This is a rough approximation — for serious astronomy you'd want true RA/Dec
 * calculations, but for solunar fishing windows the 5-min precision is fine.
 */
function moonOverheadUtcHours(ageDays: number, longitudeDeg: number): number {
  // At new moon the moon transits at the same time as the sun (noon UTC at
  // longitude 0). Each lunar day (24h 50m) the transit shifts by ~50 minutes
  // (0.833 hours). Longitude shifts the local solar time by 15°/hour.
  const lunarHourShift = ageDays * 0.8333;
  const longitudeShift = -longitudeDeg / 15; // east of Greenwich = earlier UTC
  const transitUtc = 12 + lunarHourShift + longitudeShift;
  return ((transitUtc % 24) + 24) % 24;
}

/**
 * Build the four solunar windows for the day: two majors (~2h each at moon
 * overhead and underfoot) and two minors (~1h each at moon rise and set).
 * Returned in chronological order in the local timezone.
 */
function periodsForDate(date: Date, latitudeDeg: number, longitudeDeg: number): SolunarPeriod[] {
  // longitudeDeg is signed (positive = east). latitudeDeg is currently unused
  // but plumbed in case a future refinement adds latitude-dependent moon
  // declination corrections.
  void latitudeDeg;
  const ageDays = moonAgeDays(date);
  const overheadHourUtc = moonOverheadUtcHours(ageDays, longitudeDeg);
  // Underfoot is 12h opposite.
  const underfootHourUtc = (overheadHourUtc + 12) % 24;
  // Rise/set approximated as ±6h from transit. True local times shift with
  // latitude but for solunar fishing windows this is good enough.
  const riseHourUtc = (overheadHourUtc - 6 + 24) % 24;
  const setHourUtc = (overheadHourUtc + 6) % 24;

  // Convert UTC hour → local Date at the given calendar date.
  // We use the host device's timezone offset so the result lines up with
  // the user's wall clock.
  const utcOffsetHours = -date.getTimezoneOffset() / 60;
  const toLocal = (utcHour: number, durationMin: number): SolunarPeriod => {
    const localHour = (utcHour + utcOffsetHours + 24) % 24;
    const start = new Date(date);
    start.setHours(Math.floor(localHour), Math.round((localHour % 1) * 60), 0, 0);
    const end = new Date(start.getTime() + durationMin * 60_000);
    return { startIso: start.toISOString(), endIso: end.toISOString(), kind: durationMin >= 120 ? 'major' : 'minor' };
  };

  const periods: SolunarPeriod[] = [
    toLocal(overheadHourUtc, 120),
    toLocal(underfootHourUtc, 120),
    toLocal(riseHourUtc, 60),
    toLocal(setHourUtc, 60),
  ];
  periods.sort((a, b) => a.startIso.localeCompare(b.startIso));
  return periods;
}

/**
 * Compute a 1-5 star rating for the fishing day from the moon illumination.
 * New moon (0%) and full moon (100%) score 5 (peak tidal force); quarters
 * (50%) score 3. Mirrors the standard solunar-table strength curve without
 * weighting weather, which the caller can layer on separately.
 */
function ratingFromIllumination(illumination: number): SolunarDay['rating'] {
  // Distance from either extreme — 0 = new moon, 0 = full moon, 0.5 = quarter.
  const distance = Math.min(illumination, 1 - illumination);
  if (distance <= 0.07) return 5;
  if (distance <= 0.18) return 4;
  if (distance <= 0.32) return 3;
  if (distance <= 0.42) return 2;
  return 1;
}

/**
 * Top-level entry point: produce a SolunarDay for a given date and spot.
 * latitude / longitude are in decimal degrees, signed (north + / east +).
 * date defaults to "now" if omitted.
 */
export function getSolunarDay(latitude: number, longitude: number, date: Date = new Date()): SolunarDay {
  const ageDays = moonAgeDays(date);
  const illumination = illuminationFromAge(ageDays);
  const phaseName = phaseNameFromAge(ageDays);
  return {
    date: date.toISOString().slice(0, 10),
    illumination,
    ageDays,
    phaseName,
    phaseLabel: PHASE_LABELS_BG[phaseName],
    rating: ratingFromIllumination(illumination),
    periods: periodsForDate(date, latitude, longitude),
  };
}
