import type { AchievementCategory, AchievementRarity } from '../types';

export const RARITY_COLORS: Record<
  AchievementRarity,
  { bg: string; border: string; text: string; label: string }
> = {
  common: { bg: '#E8F4EA', border: '#2E9B5A', text: '#0E2A33', label: 'Общо' },
  rare: { bg: '#E8F2FC', border: '#1A7A9C', text: '#0E2A33', label: 'Рядко' },
  epic: { bg: '#F3E8FF', border: '#7C3AED', text: '#0E2A33', label: 'Епично' },
  legendary: { bg: '#FFF4E0', border: '#E8A83A', text: '#0E2A33', label: 'Легенда' },
};

export const CATEGORY_LABELS: Record<AchievementCategory, string> = {
  quantity: 'Обем',
  weight: 'Тегло',
  trophy: 'Трофей',
  variety: 'Разнообразие',
  specialist: 'Специалист',
  release: 'Пускане',
  dedication: 'Посветеност',
  geography: 'География',
  journal: 'Дневник',
  social: 'Общност',
};

export type AchievementDef = {
  id: string;
  category: AchievementCategory;
  rarity: AchievementRarity;
  name: string;
  description: string;
  icon: string;
  target: number;
  progressFn: (catches: import('../types').Catch[]) => number;
  unlockedFn: (catches: import('../types').Catch[], opts: { syncedIds: Set<string> }) => boolean;
};

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  {
    id: 'first_catch',
    category: 'quantity',
    rarity: 'common',
    name: 'Първи улов',
    description: 'Запиши поне един улов в дневника.',
    icon: 'fish-outline',
    target: 1,
    progressFn: (c) => Math.min(1, c.length),
    unlockedFn: (c) => c.length >= 1,
  },
  {
    id: 'ten_catches',
    category: 'quantity',
    rarity: 'common',
    name: 'Десет улова',
    description: 'Натрупай 10 записа.',
    icon: 'albums-outline',
    target: 10,
    progressFn: (c) => Math.min(10, c.length),
    unlockedFn: (c) => c.length >= 10,
  },
  {
    id: 'five_kg_total',
    category: 'weight',
    rarity: 'common',
    name: '5 кг сумарно',
    description: 'Общо поне 5 кг записани тегла.',
    icon: 'barbell-outline',
    target: 5,
    progressFn: (c) => Math.min(5, Math.floor(c.reduce((s, x) => s + (x.weightKg ?? 0), 0))),
    unlockedFn: (c) => c.reduce((s, x) => s + (x.weightKg ?? 0), 0) >= 5,
  },
  {
    id: 'release_three',
    category: 'release',
    rarity: 'rare',
    name: 'Catch & release ×3',
    description: 'Три улова с „пуснат обратно".',
    icon: 'leaf-outline',
    target: 3,
    progressFn: (c) => Math.min(3, c.filter((x) => x.released).length),
    unlockedFn: (c) => c.filter((x) => x.released).length >= 3,
  },
  {
    id: 'three_species',
    category: 'variety',
    rarity: 'rare',
    name: 'Три вида',
    description: 'Улов от поне три различни вида риба.',
    icon: 'git-network-outline',
    target: 3,
    progressFn: (c) => Math.min(3, new Set(c.map((x) => x.speciesId)).size),
    unlockedFn: (c) => new Set(c.map((x) => x.speciesId)).size >= 3,
  },
  {
    id: 'cloud_sync',
    category: 'journal',
    rarity: 'epic',
    name: 'В облака',
    description: 'Поне един улов синхронизиран с облака.',
    icon: 'cloud-done-outline',
    target: 1,
    progressFn: (c) => (c.some((x) => x.syncedToCloud) ? 1 : 0),
    unlockedFn: (c, o) => c.some((x) => x.syncedToCloud) || (o.syncedIds?.size ?? 0) > 0,
  },
];