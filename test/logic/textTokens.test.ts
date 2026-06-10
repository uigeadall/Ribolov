import { describe, expect, it } from 'vitest';
import {
  extractHashtags,
  extractMentionHandles,
  tokenizeText,
} from '../../src/utils/textTokens';

describe('extractHashtags', () => {
  it('returns [] for empty input', () => {
    expect(extractHashtags('')).toEqual([]);
  });

  it('extracts and lowercases Latin + Cyrillic tags, deduped', () => {
    expect(extractHashtags('Hit #Sharan and #шаран then #Sharan again')).toEqual(['sharan', 'шаран']);
  });

  it('requires a 2-char minimum and a non-word boundary before #', () => {
    expect(extractHashtags('a#b')).toEqual([]); // no boundary (letter before #)
    expect(extractHashtags('#x')).toEqual([]);  // single char < 2
    expect(extractHashtags('hello #ok')).toEqual(['ok']);
  });
});

describe('extractMentionHandles', () => {
  it('extracts handles preserving case, allowing . - _', () => {
    expect(extractMentionHandles('hey @Ivan_Petrov and @gosho.k')).toEqual(['Ivan_Petrov', 'gosho.k']);
  });

  it('ignores @ in the middle of a word (emails)', () => {
    expect(extractMentionHandles('mail me at user@gmail')).toEqual([]);
  });
});

describe('tokenizeText', () => {
  it('returns [] for empty input', () => {
    expect(tokenizeText('')).toEqual([]);
  });

  it('splits text, hashtags, and mentions preserving order and spacing', () => {
    expect(tokenizeText('hi @ivan see #carp!')).toEqual([
      { kind: 'text', value: 'hi ' },
      { kind: 'mention', handle: 'ivan', raw: '@ivan' },
      { kind: 'text', value: ' see ' },
      { kind: 'hashtag', tag: 'carp', raw: '#carp' },
      { kind: 'text', value: '!' },
    ]);
  });
});
