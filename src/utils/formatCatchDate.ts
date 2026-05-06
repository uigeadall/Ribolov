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

export function isRemoteImageUri(uri?: string): boolean {
  return !!uri?.trim() && /^https?:\/\//i.test(uri.trim());
}
