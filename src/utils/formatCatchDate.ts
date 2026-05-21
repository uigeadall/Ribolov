/** Четима дата/час за ISO стринг от дневника (локал bg). */
export function formatCatchDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  try {
    return new Intl.DateTimeFormat('bg-BG', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString('bg-BG');
  }
}

/** Relative time: "преди 5 мин", "вчера в 14:03", "11 май" etc. */
export function formatTimeAgo(value: unknown): string {
  let ms: number;
  if (typeof value === 'number') {
    ms = value;
  } else if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    ms = (value as { toMillis: () => number }).toMillis();
  } else if (typeof value === 'string') {
    ms = Date.parse(value);
  } else {
    return '';
  }
  if (!ms || Number.isNaN(ms)) return '';

  const now = Date.now();
  const diff = now - ms;
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);

  if (sec < 60) return 'току-що';
  if (min < 60) return `преди ${min} мин`;
  if (hr < 24) return `преди ${hr} ч`;
  if (day === 1) {
    const t = new Intl.DateTimeFormat('bg-BG', { timeStyle: 'short' }).format(new Date(ms));
    return `вчера в ${t}`;
  }
  if (day < 7) return `преди ${day} дни`;
  return new Intl.DateTimeFormat('bg-BG', { dateStyle: 'medium' }).format(new Date(ms));
}

export function isRemoteImageUri(uri?: string): boolean {
  return !!uri?.trim() && /^https?:\/\//i.test(uri.trim());
}

/** YYYY-MM-DD for the supplied date in the **device's local timezone**.
 *
 * Use this — NOT `d.toISOString().slice(0, 10)` — anywhere the stored value
 * is going to be compared against user-facing labels like "Днес" / "Утре".
 * `toISOString` returns the UTC date; for any user east of UTC late at night
 * (or west of UTC early in the morning), the UTC date is one day ahead/behind
 * what they see in the picker. Storing the UTC date and showing local labels
 * means tournaments / trips / forecasts silently land on the wrong day.
 *
 * Bulgarian users (UTC+2/+3) hit this at local 00:00-03:00 — picking "Днес"
 * stores yesterday's UTC date. Tournament `endDate >= todayIso` comparisons
 * then think today's tournament has already ended.
 */
export function toLocalDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
