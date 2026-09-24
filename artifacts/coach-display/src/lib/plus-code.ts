import { OpenLocationCode } from 'open-location-code';
import type { AddressSuggestion } from '@/providers/live-trip';

const olc = new OpenLocationCode();
const OLC_CHARACTERS = /^[23456789CFGHJMPQRVWX0]*\+[23456789CFGHJMPQRVWX]*$/i;
const MIN_EXACT_CODE_LENGTH = 10;

export class PlusCodeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlusCodeInputError';
  }
}

export type LocalityLookup = (locality: string, signal?: AbortSignal) => Promise<AddressSuggestion[]>;

function candidateParts(query: string) {
  const trimmed = query.trim();
  const match = /^([^\s,]+)(?:[\s,]+(.+))?$/.exec(trimmed);
  if (!match || !match[1].includes('+')) return null;
  const code = match[1];
  const locality = match[2]?.trim() ?? '';
  if (OLC_CHARACTERS.test(code)) return { code, locality };

  // Do not turn ordinary text such as “A+B” into a Plus Code error. A long,
  // mostly OLC-looking prefix is practical evidence that a code was intended.
  const beforePlus = code.slice(0, code.indexOf('+'));
  if (beforePlus.length >= 4 && /\d/.test(beforePlus) && /^[A-Z0-9]+$/i.test(beforePlus)) {
    throw new PlusCodeInputError(
      'That Plus Code is malformed. Check the characters and “+”, or enter a complete address.',
    );
  }
  return null;
}

function assertFiniteCoordinates(lat: number, lng: number, description: string) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new PlusCodeInputError(`${description} returned invalid coordinates. Try a more specific city and state.`);
  }
}

function distanceKm(a: AddressSuggestion, b: AddressSuggestion) {
  const radians = Math.PI / 180;
  const lat1 = a.lat * radians;
  const lat2 = b.lat * radians;
  const dLat = (b.lat - a.lat) * radians;
  const dLng = (b.lng - a.lng) * radians;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function localityReference(locality: string, results: AddressSuggestion[]) {
  const town = locality.split(',')[0].trim().toLocaleLowerCase();
  const usable = results.filter((result) => {
    assertFiniteCoordinates(result.lat, result.lng, 'The locality search');
    return /geography|municipality|city|town|village/i.test(result.type)
      && result.label.toLocaleLowerCase().includes(town);
  });
  if (usable.length === 0) {
    throw new PlusCodeInputError(
      `Could not confidently find “${locality}”. Add the city and state, or enter the full Plus Code.`,
    );
  }
  const distantMatch = usable.slice(1).find((candidate) => distanceKm(usable[0], candidate) > 40);
  if (distantMatch) {
    throw new PlusCodeInputError(
      `“${locality}” is ambiguous. Add the state or country, or enter the full Plus Code.`,
    );
  }
  return usable[0];
}

function significantLength(code: string) {
  return code.replace('+', '').replace(/0/g, '').length;
}

function suggestionForFullCode(fullCode: string): AddressSuggestion {
  if (!olc.isFull(fullCode)) {
    throw new PlusCodeInputError(
      'That Plus Code is not valid. Check the characters and “+”, and include a city for a shortened code.',
    );
  }
  if (significantLength(fullCode) < MIN_EXACT_CODE_LENGTH) {
    throw new PlusCodeInputError(
      'That Plus Code covers too broad an area for an exact stop. Enter a more precise code (about 10 characters) or an address.',
    );
  }
  const area = olc.decode(fullCode);
  assertFiniteCoordinates(area.latitudeCenter, area.longitudeCenter, 'The Plus Code');
  const normalized = olc.encode(area.latitudeCenter, area.longitudeCenter, area.codeLength);
  const northSouthMeters = Math.abs(area.latitudeHi - area.latitudeLo) * 111_320;
  const eastWestMeters = Math.abs(area.longitudeHi - area.longitudeLo)
    * 111_320 * Math.cos(area.latitudeCenter * Math.PI / 180);
  const precisionMeters = Math.max(northSouthMeters, eastWestMeters);
  const label = `${normalized} Plus Code — ${area.latitudeCenter.toFixed(6)}, ${area.longitudeCenter.toFixed(6)}`
    + ` (≈${Math.max(1, Math.round(precisionMeters))} m area center, not exact curbside)`;
  return {
    id: `plus-code-${normalized}`,
    label,
    lat: area.latitudeCenter,
    lng: area.longitudeCenter,
    type: 'Plus Code',
  };
}

export async function resolvePlusCodeSuggestion(
  query: string,
  lookupLocality: LocalityLookup,
  signal?: AbortSignal,
): Promise<AddressSuggestion | null> {
  const parts = candidateParts(query);
  if (!parts) return null;
  const normalizedCode = parts.code.toUpperCase();
  if (!olc.isValid(normalizedCode)) {
    throw new PlusCodeInputError(
      'That Plus Code is malformed. Check the characters and “+”, or enter a complete address.',
    );
  }
  if (olc.isFull(normalizedCode)) return suggestionForFullCode(normalizedCode);
  if (!olc.isShort(normalizedCode)) {
    throw new PlusCodeInputError('Enter a valid full Plus Code, or a shortened code followed by its city and state.');
  }
  if (!parts.locality || !/[a-z]{3,}/i.test(parts.locality)) {
    throw new PlusCodeInputError(
      'A shortened Plus Code needs an explicit town or city. Add the city and state, or enter the full Plus Code.',
    );
  }
  const locality = localityReference(parts.locality, await lookupLocality(parts.locality, signal));
  const recovered = olc.recoverNearest(normalizedCode, locality.lat, locality.lng);
  return suggestionForFullCode(recovered);
}