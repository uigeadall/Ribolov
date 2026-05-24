# Alternate app icons

Three placeholder files live here right now — `Sharan.png`, `Shtuka.png`, `Som.png` — all of them copies of the default `assets/icon.png`. That keeps the build green and the picker UI functional, but the user sees three visually identical icons in `Профил → Настройки → Икона на приложението`.

## To make the variants actually distinct

1. Design three 1024×1024 PNGs (one per species — carp / pike / catfish). Same icon style as `assets/icon.png`; iOS auto-generates the smaller sizes from the 1024.
2. Replace these placeholder files with your real designs (keep the filenames so `app.json` and `src/services/appIcon.ts` don't need to change):
   - `assets/app-icons/Sharan.png`  → Шаран (carp)
   - `assets/app-icons/Shtuka.png`  → Щука (pike)
   - `assets/app-icons/Som.png`     → Сом (catfish)
3. Rebuild — alternate icons cannot be added via OTA; they require a new binary.
   - Dev: `npx expo prebuild --clean && npx expo run:ios`
   - Production: `npm run build:testflight`

## Add a new variant

1. Drop a 1024×1024 PNG into this directory.
2. Add an entry to the plugin config in `app.json` under `expo-dynamic-app-icon`.
3. Add a matching entry in `APP_ICON_VARIANTS` in `src/services/appIcon.ts`.
4. Rebuild.

## Android

Android works via activity-alias declarations that `expo-dynamic-app-icon` generates during prebuild. Switching app icons on Android briefly closes and reopens the app, which is jarring — the picker UI is iOS-only for that reason. To enable Android: remove the `Platform.OS === 'ios'` guard in `AppIconPickerScreen` and run `npx expo prebuild --clean` so the AndroidManifest entries get added.
