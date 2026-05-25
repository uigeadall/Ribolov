import AsyncStorage from '../storage/kv';

/**
 * In-app rating prompt — fires once-ever via `expo-store-review` after the
 * user has logged a meaningful number of catches. Apple/Google quota the
 * native prompt to ~3 fires per year, so spamming it gets you nothing;
 * we cap at exactly one show across the user's entire app lifetime via
 * AsyncStorage, then let the OS handle further "rate this app" surfaces
 * organically.
 *
 * Lazy + try-caught require of the native module follows the same pattern
 * as appIcon.ts / analytics.ts — keeps the app booting in Expo Go and
 * pre-rebuild dev clients where the native side isn't bundled.
 */

const SHOWN_KEY = '@ribolov/storeReviewShown';
const TRIGGER_CATCH_COUNT = 10;

type StoreReviewModule = {
  hasAction: () => Promise<boolean>;
  requestReview: () => Promise<void>;
  isAvailableAsync: () => Promise<boolean>;
};

let cachedMod: StoreReviewModule | null | undefined = undefined;
function loadStoreReview(): StoreReviewModule | null {
  if (cachedMod !== undefined) return cachedMod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedMod = require('expo-store-review') as StoreReviewModule;
    return cachedMod;
  } catch {
    cachedMod = null;
    return null;
  }
}

/**
 * Call after a catch save with the user's current total catch count.
 * Shows the OS rating prompt exactly once when the user crosses the
 * 10th catch threshold — that's a "they're engaged" signal strong
 * enough that an interruption is justified. Earlier thresholds get
 * dismissed; later ones (people who don't reach 10 quickly) get caught
 * here organically.
 *
 * Best-effort throughout: missing native module → no-op, AsyncStorage
 * failure → no-op, OS-side throttle → no-op. We never crash or block
 * the save flow on a rating prompt.
 */
export async function maybePromptForReview(totalCatchCount: number): Promise<void> {
  if (totalCatchCount < TRIGGER_CATCH_COUNT) return;
  try {
    const alreadyShown = await AsyncStorage.getItem(SHOWN_KEY).catch(() => null);
    if (alreadyShown) return;
    const mod = loadStoreReview();
    if (!mod) return;
    const available = await mod.isAvailableAsync().catch(() => false);
    if (!available) return;
    const hasAction = await mod.hasAction().catch(() => false);
    if (!hasAction) return;
    // Mark BEFORE awaiting the prompt — Apple/Google may silently no-op
    // due to their own throttling (~3 prompts per year per app), and we
    // don't want to retry on the next save. Once we've spent the show
    // budget, that's it.
    await AsyncStorage.setItem(SHOWN_KEY, '1').catch(() => undefined);
    await mod.requestReview().catch(() => undefined);
  } catch {
    /* swallow — rating UX must never interfere with the underlying flow */
  }
}
