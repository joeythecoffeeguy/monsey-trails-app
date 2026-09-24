import { describe, expect, it, vi } from 'vitest';
import { PlusCodeInputError, resolvePlusCodeSuggestion } from './plus-code';

const noLookup = vi.fn(() => Promise.resolve([]));

describe('Plus Code destination resolution', () => {
  it('decodes a lower-case full code and ignores its compound locality suffix', async () => {
    const result = await resolvePlusCodeSuggestion('849vcwc8+r9 Mountain View, CA', noLookup);

    expect(result).toMatchObject({
      id: 'plus-code-849VCWC8+R9',
      lat: 37.422062499999996,
      lng: -122.0840625,
      type: 'Plus Code',
    });
    expect(result?.label).toContain('849VCWC8+R9');
    expect(result?.label).toContain('not exact curbside');
    expect(noLookup).not.toHaveBeenCalled();
  });

  it('recovers a compound short code only from an explicit, unambiguous locality', async () => {
    const lookup = vi.fn(() => Promise.resolve([
      { id: 'mountain-view', label: 'Mountain View, CA', lat: 37.3861, lng: -122.0839, type: 'Geography' },
    ]));

    const result = await resolvePlusCodeSuggestion('CWC8+R9, Mountain View, CA', lookup);

    expect(lookup).toHaveBeenCalledWith('Mountain View, CA', undefined);
    expect(result).toMatchObject({
      id: 'plus-code-849VCWC8+R9',
      lat: 37.422062499999996,
      lng: -122.0840625,
    });
  });

  it('rejects a bare short code rather than recovering from device or default location', async () => {
    await expect(resolvePlusCodeSuggestion('CWC8+R9', noLookup)).rejects.toThrow(
      'needs an explicit town or city',
    );
    expect(noLookup).not.toHaveBeenCalled();
  });

  it('rejects malformed and excessively broad code-like input clearly', async () => {
    await expect(resolvePlusCodeSuggestion('849VCWC8+R!', noLookup)).rejects.toBeInstanceOf(PlusCodeInputError);
    await expect(resolvePlusCodeSuggestion('849VCW00+', noLookup)).rejects.toThrow('too broad an area');
  });

  it('rejects ambiguous or low-confidence locality results instead of guessing', async () => {
    const ambiguous = vi.fn(() => Promise.resolve([
      { id: 'one', label: 'Springfield, IL', lat: 39.7817, lng: -89.6501, type: 'Geography' },
      { id: 'two', label: 'Springfield, MA', lat: 42.1015, lng: -72.5898, type: 'Geography' },
    ]));
    const lowConfidence = vi.fn(() => Promise.resolve([
      { id: 'poi', label: 'Monsey Mall', lat: 41.111, lng: -74.068, type: 'POI' },
    ]));

    await expect(resolvePlusCodeSuggestion('CWC8+R9 Springfield', ambiguous)).rejects.toThrow('ambiguous');
    await expect(resolvePlusCodeSuggestion('CWC8+R9 Nowhere', lowConfidence)).rejects.toThrow(
      'Could not confidently find',
    );
  });

  it.each([
    '1600 Amphitheatre Parkway, Mountain View, CA',
    '18th Avenue & 49th Street, Brooklyn, NY',
    'A+B Logistics, Monsey, NY',
  ])('leaves ordinary address/intersection text for existing search: %s', async (query) => {
    await expect(resolvePlusCodeSuggestion(query, noLookup)).resolves.toBeNull();
  });
});