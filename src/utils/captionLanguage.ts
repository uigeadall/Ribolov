import { Linking } from 'react-native';

/**
 * Heuristic check: does this caption look like it's NOT in Bulgarian (or any
 * Cyrillic language)? We don't have a real language-detection library in the
 * bundle, so the rule is intentionally simple:
 *
 *   - Strip URLs, hashtags, mentions, emojis, whitespace, punctuation.
 *   - Of what's left, what fraction of letters are Cyrillic?
 *   - If the caption has at least 12 letters AND <30% are Cyrillic, treat it
 *     as foreign-language and offer a translation toggle.
 *
 * The 12-letter floor avoids false positives on captions like "🎣 nice" or
 * "@ivan thx" where the meaningful content is too short to confidently call
 * it foreign-language.
 */
export function looksNonBulgarian(text: string | undefined | null): boolean {
  if (!text) return false;
  // Strip URLs, hashtag tokens, mention tokens — they're noise for detection.
  const stripped = text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/@[\p{L}\p{N}_]+/gu, ' ');

  // Count letters (any script) and Cyrillic letters specifically.
  const letters = stripped.match(/\p{L}/gu) ?? [];
  if (letters.length < 12) return false;
  const cyrillic = stripped.match(/[Ѐ-ӿ]/g) ?? [];
  return cyrillic.length / letters.length < 0.3;
}

/**
 * Opens the system's translation flow for `text`. We try a sequence of
 * deep-links — the first one that resolves wins:
 *
 *   1. Google Translate app (`googletranslate://`) — when installed
 *      (extremely common on Android, common on iOS).
 *   2. Apple Translate via the universal `translate://` URL — iOS 15+ users
 *      who don't have Google Translate get the native sheet.
 *   3. Google Translate web URL — universal fallback, always works.
 *
 * This is intentionally a deep-link approach rather than an in-app
 * translation: no third-party API key, no rate limit, no PII leaving the
 * device to a service the user didn't choose.
 */
export async function openTranslation(text: string, sourceLang = 'auto', targetLang = 'bg'): Promise<void> {
  const encoded = encodeURIComponent(text);

  // 1) Google Translate app deep link. The "ie=UTF-8" + "sl=auto" pattern is
  //    the same one the share-sheet "Translate" extension uses.
  const gtApp = `googletranslate://?sl=${sourceLang}&tl=${targetLang}&text=${encoded}`;
  try {
    if (await Linking.canOpenURL(gtApp)) {
      await Linking.openURL(gtApp);
      return;
    }
  } catch { /* fall through */ }

  // 2) Apple Translate (iOS native) — the URL scheme is `translate://`.
  //    Only the source/target codes get passed; the user pastes / re-types
  //    the text on the native screen. Less convenient than Google's app but
  //    a reasonable default for iOS users without Google Translate installed.
  const appleTranslate = `translate://?sl=${sourceLang}&tl=${targetLang}&text=${encoded}`;
  try {
    if (await Linking.canOpenURL(appleTranslate)) {
      await Linking.openURL(appleTranslate);
      return;
    }
  } catch { /* fall through */ }

  // 3) Universal fallback — web URL. Always opens in the user's browser.
  const webUrl = `https://translate.google.com/?sl=${sourceLang}&tl=${targetLang}&text=${encoded}&op=translate`;
  await Linking.openURL(webUrl);
}
