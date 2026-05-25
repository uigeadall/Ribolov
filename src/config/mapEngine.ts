/**
 * Карта на екрана „Карта“:
 * - `true` → react-native-maps (нативна Apple/Google карта)
 * - `false` → Leaflet през WebView (предишното поведение)
 *
 * Смени на `false` по всяко време, за да се върнеш към Leaflet без други промени.
 *
 * NOTE on react-native-maps + Android sideload builds:
 *   Google Maps SDK on Android renders blank when the API key isn't
 *   allowlisted for the SHA-1 of the signing certificate. EAS Build
 *   generates its own keystore (different SHA-1 from local debug builds),
 *   so APKs sideloaded to test devices see no tiles unless that SHA-1 is
 *   added to the API key restriction in Google Cloud Console. For now
 *   we ship Leaflet (no key required, works on any keystore). Switch back
 *   to `true` once the SHA-1 is registered — get it via:
 *     `npx eas-cli credentials -p android` → pick the build profile →
 *     "Application identifier" section shows the SHA-1.
 *   Then in Google Cloud Console → Credentials → your Maps key →
 *   Application restrictions → Android apps → add com.ribolov.app + SHA-1.
 */
export const USE_REACT_NATIVE_MAPS = false;
