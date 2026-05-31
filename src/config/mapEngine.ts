/**
 * Карта на екрана „Карта“ — избор на map engine.
 *
 * - `'maplibre'` → MapLibre Native (по подразбиране). Безплатно, без API
 *    ключове, работи на всеки keystore. Изисква native build (не Expo Go).
 *    Standard карта = OpenFreeMap (OSM vector); satellite/hybrid = Esri
 *    World Imagery (raster) — същите тайлове като Leaflet engine.
 *
 * - `'native'` → `react-native-maps` (Apple Maps на iOS, Google Maps на
 *    Android). Изисква Google Maps API ключ + SHA-1 за всеки keystore.
 *    EAS Build prod keystore-ът има различен SHA-1 от local debug, така
 *    че sideload-нати APK-та виждат празна карта докато SHA-1 не се
 *    добави в Google Cloud Console (Credentials → ключ → Android apps).
 *    Вземане на SHA-1: `npx eas-cli credentials -p android`.
 *
 * - `'leaflet'` → Leaflet през WebView (старият fallback). Безплатно, без
 *    ключове, но WebView-то прави pan/zoom да трепти.
 */
export type MapEngine = 'maplibre' | 'native' | 'leaflet';

// `as MapEngine` keeps the type as the wider union — without it, TS narrows
// the `const` to its literal value and downstream `MAP_ENGINE === 'other'`
// comparisons become "no overlap" errors.
export const MAP_ENGINE = 'maplibre' as MapEngine;

/** @deprecated Use {@link MAP_ENGINE} === 'native' instead. Kept temporarily
 *  so existing screens don't break during the engine swap. */
export const USE_REACT_NATIVE_MAPS = MAP_ENGINE === 'native';
