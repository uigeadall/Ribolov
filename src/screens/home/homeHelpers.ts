// Shared home-screen helpers + constants, extracted from HomeScreen so the
// section components can use them without importing the screen.

/** Corner radius of the "wave" that the content rises over the hero with.
    Used by the hero's bottom padding and the wave wrapper. */
export const WAVE = 32;

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Добро утро';
  if (h < 18) return 'Добър ден';
  return 'Добър вечер';
}

export function fishingLabel(rating: number): { text: string; color: string } {
  if (rating >= 4) return { text: 'Перфектно за риболов', color: '#34C97A' };
  if (rating >= 3) return { text: 'Добри условия', color: '#F5C842' };
  return { text: 'Умерени условия', color: '#F5890A' };
}

export function moonPhaseEmoji(name: string): string {
  const n = (name ?? '').toLowerCase();
  if (n.includes('нова') || n.includes('new')) return '🌑';
  if (n.includes('пълн') || n.includes('full')) return '🌕';
  if ((n.includes('нараст') || n.includes('wax')) && n.includes('четв')) return '🌓';
  if ((n.includes('нам') || n.includes('wan')) && n.includes('четв')) return '🌗';
  return '🌕';
}
