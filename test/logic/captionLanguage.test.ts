import { describe, expect, it, vi } from 'vitest';

// captionLanguage imports Linking from react-native; stub it for node.
vi.mock('react-native', () => ({ Linking: { canOpenURL: async () => false, openURL: async () => {} } }));

import { looksNonBulgarian } from '../../src/utils/captionLanguage';

describe('looksNonBulgarian', () => {
  it('returns false for empty / null / too-short text (< 12 letters)', () => {
    expect(looksNonBulgarian('')).toBe(false);
    expect(looksNonBulgarian(null)).toBe(false);
    expect(looksNonBulgarian('🎣 nice')).toBe(false);
    expect(looksNonBulgarian('@ivan thx')).toBe(false);
  });

  it('returns false for a clearly Bulgarian caption', () => {
    expect(looksNonBulgarian('Страхотен улов на язовира днес сутринта')).toBe(false);
  });

  it('returns true for an English caption of sufficient length', () => {
    expect(looksNonBulgarian('What a great morning catch at the lake today')).toBe(true);
  });

  it('strips urls / hashtags / mentions before judging', () => {
    expect(
      looksNonBulgarian('amazing fishing session today #риболов @ivan https://x.co/a'),
    ).toBe(true);
  });
});
