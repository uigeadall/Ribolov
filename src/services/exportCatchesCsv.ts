import type { Catch } from '../types';

export function catchesToCsv(rows: Catch[]): string {
  const header = ['id', 'date', 'species', 'weightKg', 'lengthCm', 'released', 'notes'].join(',');
  const lines = rows.map((r) =>
    [
      r.id,
      r.date,
      JSON.stringify(r.speciesName),
      r.weightKg ?? '',
      r.lengthCm ?? '',
      r.released ? '1' : '0',
      JSON.stringify(r.notes ?? ''),
    ].join(',')
  );
  return [header, ...lines].join('\n');
}
