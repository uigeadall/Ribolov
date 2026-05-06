type Ban = { from: string; to: string; note?: string };

/** Опростена проверка — може да се разшири с календар спрямо днешната дата. */
export function checkBanPeriod(banPeriod?: Ban): {
  active: boolean;
  from?: string;
  to?: string;
  note?: string;
} {
  if (!banPeriod) return { active: false };
  return { active: false, from: banPeriod.from, to: banPeriod.to, note: banPeriod.note };
}

export async function cancelMorningNotification(): Promise<void> {}
export async function cancelAllTripReminders(): Promise<void> {}
