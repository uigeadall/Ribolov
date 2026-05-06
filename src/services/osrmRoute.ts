/** Точка WGS84 за заявки към OSRM. */
export type GeoPoint = { latitude: number; longitude: number };

/**
 * Маршрут по пътна мрежа чрез публичния OSRM демо сървър.
 * Заб.: има ограничения по товар и SLA — за продукция помисли за собствен OSRM / платена Directions услуга.
 *
 * @see https://project-osrm.org/
 */
export async function fetchDrivingRoutePoints(from: GeoPoint, to: GeoPoint): Promise<GeoPoint[]> {
  const a = `${from.longitude},${from.latitude}`;
  const b = `${to.longitude},${to.latitude}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${a};${b}?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      code?: string;
      routes?: { geometry?: { type?: string; coordinates?: [number, number][] } }[];
    };
    if (data.code !== 'Ok') throw new Error(data.code ?? 'NoRoute');
    const coords = data.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) throw new Error('Empty geometry');

    return coords.map(([lng, lat]) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Bad coord');
      return { latitude: lat, longitude: lng };
    });
  } finally {
    clearTimeout(timer);
  }
}
