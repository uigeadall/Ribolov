import { Platform } from 'react-native';

/**
 * Alternate app icon switching.
 *
 * Wraps `expo-dynamic-app-icon` with a lazy + try-caught require so the app
 * still boots when the native module isn't bundled (Expo Go, an older dev
 * client built before this dependency was added, or a snapshot from before
 * `expo prebuild` was re-run). The package's top-level calls
 * `requireNativeModule('ExpoDynamicAppIcon')` synchronously — a plain
 * `import` from it would crash the JS runtime at startup the moment any
 * screen indirectly references this file. The on-demand `require` here
 * confines that risk to whoever actually calls into the icon API.
 *
 * Variants are registered in two places that must stay in sync:
 *   1. `app.json` → plugins → `expo-dynamic-app-icon` (the build-time plist
 *      registration that lets iOS know these alternates exist).
 *   2. `APP_ICON_VARIANTS` below (the runtime list the picker UI reads).
 *
 * Why "Default" is registered as an alternate pointing at icon.png: the
 * plugin's JS API can't pass `null` to iOS's `setAlternateIconName:` (which
 * would normally reset to the primary icon). Workaround is to register the
 * primary as an alternate too, so the picker can offer a "go back to
 * default" option that's a regular switch instead of needing a special reset
 * code path.
 */

export type AppIconId = 'Default' | 'Sharan' | 'Shtuka' | 'Som';

export type AppIconVariant = {
  /** Plugin name passed to `setAppIcon`. Must match an entry in app.json. */
  id: AppIconId;
  /** Display name in the picker (Bulgarian). */
  name: string;
  /** Local-asset module reference for rendering the thumbnail. */
  preview: number;
};

export const APP_ICON_VARIANTS: AppIconVariant[] = [
  { id: 'Default', name: 'По подразбиране', preview: require('../../assets/icon.png') },
  { id: 'Sharan',  name: 'Шаран',           preview: require('../../assets/app-icons/Sharan.png') },
  { id: 'Shtuka',  name: 'Щука',            preview: require('../../assets/app-icons/Shtuka.png') },
  { id: 'Som',     name: 'Сом',             preview: require('../../assets/app-icons/Som.png') },
];

type NativeApi = {
  setAppIcon: (name: string) => string | false;
  getAppIcon: () => string;
};

// `undefined` = haven't tried loading yet; `null` = tried and failed (native
// module missing). Cached so repeated calls don't keep paying the
// require-throws cost on dev clients that lack the native code.
let cachedNative: NativeApi | null | undefined = undefined;

function loadNative(): NativeApi | null {
  if (cachedNative !== undefined) return cachedNative;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-dynamic-app-icon') as NativeApi;
    cachedNative = mod;
    return mod;
  } catch {
    cachedNative = null;
    return null;
  }
}

/** True only on platforms where switching is supported AND the native module
    is actually bundled into the running binary. iOS without a fresh build
    (e.g. the dev client predates `npm install expo-dynamic-app-icon`) reports
    false here so the picker UI can render a clear "rebuild needed" message
    rather than throwing. Android is excluded because the plugin's switch
    closes + reopens the app — supported but a poor UX. */
export function isAppIconSwitchingSupported(): boolean {
  return Platform.OS === 'ios' && loadNative() !== null;
}

/** Distinguishes "native module not built into this binary" from "platform
    doesn't support this at all". Lets the picker show a copy that points at
    the right fix (rebuild vs "iOS only"). */
export function isAppIconNativeAvailable(): boolean {
  return loadNative() !== null;
}

/** Reads the currently-active icon. iOS returns `'DEFAULT'` when no alternate
    has ever been set — we collapse that into `'Default'` so the picker can
    highlight the row consistently regardless of whether the user has
    previously chosen a variant. */
export function getCurrentAppIcon(): AppIconId {
  if (Platform.OS !== 'ios') return 'Default';
  const native = loadNative();
  if (!native) return 'Default';
  try {
    const raw = native.getAppIcon();
    if (!raw || raw === 'DEFAULT') return 'Default';
    if (raw === 'Default' || raw === 'Sharan' || raw === 'Shtuka' || raw === 'Som') return raw;
    return 'Default';
  } catch {
    return 'Default';
  }
}

/** Switches to the requested variant. Resolves to `true` when the OS accepts
    the change, `false` otherwise. iOS shows its own confirmation alert
    before applying — we don't add a second one on top. */
export async function changeAppIcon(id: AppIconId): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  const native = loadNative();
  if (!native) return false;
  try {
    const result = native.setAppIcon(id);
    return result !== false;
  } catch {
    return false;
  }
}
