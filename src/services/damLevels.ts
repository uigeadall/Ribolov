/**
 * Нива на язовирите — данни от МОСВ (Министерство на околната среда и водите).
 *
 * Публичните данни са достъпни на: https://www.water.government.bg/
 * За да активираш реалните данни, получи API ключ от data.egov.bg и актуализирай URL-а.
 *
 * До тогава се използват кешираните/приблизителни стойности.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type DamLevel = {
  damId: string;
  fillPercent: number;     // 0–100
  volumeMcm?: number;      // million cubic metres
  inflowMcm?: number;      // daily inflow
  updatedAt: string;       // ISO date
};

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const CACHE_KEY_PREFIX = '@ribolov/damLevel:';

/**
 * Опитва се да вземе нивото на язовира от публичния МОСВ/НЕК API.
 * Ако заявката пропадне, връща null — UI показва „данни недостъпни" gracefully.
 *
 * Сменяй URL-а тук, когато официалният endpoint стане наличен.
 */
async function fetchLevelFromAPI(damId: string): Promise<DamLevel | null> {
  // ← Смени с реалния МОСВ endpoint когато е наличен.
  // Например: https://api.water.government.bg/dams/{damId}/level
  const url = `https://data.egov.bg/api/dams/${encodeURIComponent(damId)}/level`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    if (typeof json?.fillPercent !== 'number') return null;
    return {
      damId,
      fillPercent: Math.max(0, Math.min(100, Math.round(json.fillPercent * 10) / 10)),
      volumeMcm: json.volumeMcm ?? undefined,
      inflowMcm: json.inflowMcm ?? undefined,
      updatedAt: json.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function getDamLevel(damId: string): Promise<DamLevel | null> {
  const cacheKey = CACHE_KEY_PREFIX + damId;
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (raw) {
      const parsed = JSON.parse(raw) as { at: number; data: DamLevel };
      if (Date.now() - parsed.at < CACHE_TTL_MS) return parsed.data;
    }
  } catch {
    /* ignore bad cache */
  }

  const fresh = await fetchLevelFromAPI(damId);
  if (fresh) {
    AsyncStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data: fresh })).catch(() => {});
  }
  return fresh;
}
