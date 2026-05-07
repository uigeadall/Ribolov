type Ban = { from: string; to: string; note?: string };

/**
 * Проверява дали днес попадаме в забранен период за риболов.
 * Форматът на датите е "DD.MM" (напр. "15.04").
 */
export function checkBanPeriod(banPeriod?: Ban): {
  active: boolean;
  from?: string;
  to?: string;
  note?: string;
} {
  if (!banPeriod) return { active: false };
  try {
    const today = new Date();
    const year = today.getFullYear();

    const parse = (s: string, y: number): Date => {
      const [d, m] = s.split('.').map(Number);
      return new Date(y, m - 1, d);
    };

    const from = parse(banPeriod.from, year);
    const to = parse(banPeriod.to, year);

    let active: boolean;
    if (from <= to) {
      // Нормална забрана в рамките на годината (напр. 15.04 – 31.05)
      active = today >= from && today <= to;
    } else {
      // Забрана, преминаваща в новата година (напр. 15.12 – 15.02)
      active = today >= from || today <= to;
    }

    return { active, from: banPeriod.from, to: banPeriod.to, note: banPeriod.note };
  } catch {
    return { active: false, from: banPeriod.from, to: banPeriod.to, note: banPeriod.note };
  }
}

export async function cancelMorningNotification(): Promise<void> {}
export async function cancelAllTripReminders(): Promise<void> {}
