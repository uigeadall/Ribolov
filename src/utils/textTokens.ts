/**
 * Helpers for parsing #hashtags and @mentions out of free-form post / comment text.
 *
 * Hashtag rules: '#' immediately followed by one or more Cyrillic / Latin letters
 * or digits. Stored normalised to lowercase with no leading '#'.
 *
 * Mention rules: '@' immediately followed by one or more Cyrillic / Latin letters,
 * digits, dots, hyphens, or underscores. Stored verbatim (case preserved).
 */

const HASHTAG_RE = /(^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]{2,40})/gu;
const MENTION_RE = /(^|[^\p{L}\p{N}_])@([\p{L}\p{N}_.\-]{2,40})/gu;

export function extractHashtags(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(HASHTAG_RE)) {
    out.add(m[2].toLowerCase());
  }
  return [...out];
}

export function extractMentionHandles(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(MENTION_RE)) {
    out.add(m[2]);
  }
  return [...out];
}

export type TextToken =
  | { kind: 'text'; value: string }
  | { kind: 'hashtag'; tag: string; raw: string }
  | { kind: 'mention'; handle: string; raw: string };

/**
 * Tokenises text into a sequence of plain segments, hashtags, and mentions so
 * the renderer can wrap each in a tappable element. Preserves spacing.
 */
export function tokenizeText(text: string): TextToken[] {
  if (!text) return [];
  const tokens: TextToken[] = [];
  // Combined regex with two named-style groups; switch on which one matched.
  const combined = /(?:(?<=^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]{2,40}))|(?:(?<=^|[^\p{L}\p{N}_])@([\p{L}\p{N}_.\-]{2,40}))/gu;
  let lastIdx = 0;
  for (const m of text.matchAll(combined)) {
    const idx = m.index ?? 0;
    if (idx > lastIdx) {
      tokens.push({ kind: 'text', value: text.slice(lastIdx, idx) });
    }
    if (m[1] != null) {
      tokens.push({ kind: 'hashtag', tag: m[1].toLowerCase(), raw: `#${m[1]}` });
    } else if (m[2] != null) {
      tokens.push({ kind: 'mention', handle: m[2], raw: `@${m[2]}` });
    }
    lastIdx = idx + m[0].length;
  }
  if (lastIdx < text.length) {
    tokens.push({ kind: 'text', value: text.slice(lastIdx) });
  }
  return tokens;
}
