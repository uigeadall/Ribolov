// Shared home-screen helpers + constants, extracted from HomeScreen so the
// section components can use them without importing the screen.

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Добро утро';
  if (h < 18) return 'Добър ден';
  return 'Добър вечер';
}

export function fishingLabel(rating: number): { text: string; color: string } {
  if (rating >= 4) return { text: 'Перфектно за риболов', color: '#34C97A' };
  if (rating >= 3) return { text: 'Добри условия', color: '#F5C842' };
  // Semantic amber — decoupled from the retired brand orange #F5890A.
  return { text: 'Умерени условия', color: '#F0A830' };
}

export function moonPhaseEmoji(name: string): string {
  const n = (name ?? '').toLowerCase();
  if (n.includes('нова') || n.includes('new')) return '🌑';
  if (n.includes('пълн') || n.includes('full')) return '🌕';
  if ((n.includes('нараст') || n.includes('wax')) && n.includes('четв')) return '🌓';
  if ((n.includes('нам') || n.includes('wan')) && n.includes('четв')) return '🌗';
  return '🌕';
}
