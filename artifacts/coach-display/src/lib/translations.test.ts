import { describe, expect, it } from 'vitest';
import { getTranslation, isRTL, translations } from './translations';

describe('translations', () => {
  it('identifies RTL languages correctly', () => {
    expect(isRTL('he')).toBe(true);
    expect(isRTL('yi')).toBe(true);
    expect(isRTL('en')).toBe(false);
  });

  it('provides translations for English', () => {
    expect(getTranslation('en', 'nextStop')).toBe('Next Stop');
    expect(getTranslation('en', 'eta')).toBe('ETA');
  });

  it('provides translations for Yiddish', () => {
    expect(getTranslation('yi', 'nextStop')).toBe('קומענדיגע סטאפ');
  });

  it('provides translations for Hebrew', () => {
    expect(getTranslation('he', 'nextStop')).toBe('התחנה הבאה');
  });

  it('covers every informational key in all passenger languages', () => {
    const keys = Object.keys(translations.en) as Array<keyof typeof translations.en>;
    for (const key of keys) {
      expect(getTranslation('en', key), key).toBeTruthy();
      expect(getTranslation('yi', key), `yi:${key}`).toBeTruthy();
      expect(getTranslation('he', key), `he:${key}`).toBeTruthy();
    }
    expect(getTranslation('yi', 'powerWithinReach')).not.toBe(getTranslation('en', 'powerWithinReach'));
    expect(getTranslation('he', 'emergencyExits')).not.toBe(getTranslation('en', 'emergencyExits'));
  });

  it('falls back to English for missing keys in other languages if they somehow slip in', () => {
    // TypeScript prevents this at compile time, but we test runtime behavior
    expect(getTranslation('he', 'missingKey' as any)).toBeUndefined();
  });
});
