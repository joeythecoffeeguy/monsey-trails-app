const LOCALITY_ALIASES: Record<string, string> = {
  'Borough Park': 'Boro Park',
};

const NON_LOCALITY_PARTS = [
  /^United States(?: of America)?$/i,
  /^USA$/i,
  /^New York$/i,
  /^NY$/i,
  /^\d{5}(?:-\d{4})?$/,
  / County$/i,
  /^City of New York$/i,
];

function isNonLocality(part: string) {
  return NON_LOCALITY_PARTS.some((pattern) => pattern.test(part));
}

const STREET_PART = /\b(?:avenue|ave|street|st|road|rd|boulevard|blvd|lane|ln|drive|dr|parkway|pkwy|place|pl|court|ct|terrace|ter|highway|hwy|way)\b\.?$/i;

function isStreet(part: string) {
  return STREET_PART.test(part);
}

export function formatPassengerDestination(address: string) {
  const parts = address
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return '';

  const isSeparateHouseNumber = /^\d+[A-Z-]?$/i.test(parts[0]);
  const isCombinedStreetAddress = /^\d+[A-Z-]?\s/i.test(parts[0]);
  const streetStart = isSeparateHouseNumber ? 1 : 0;
  if (isStreet(parts[streetStart] ?? '') && isStreet(parts[streetStart + 1] ?? '')) {
    return `${parts[streetStart]} & ${parts[streetStart + 1]}`;
  }

  const localityCandidates = isSeparateHouseNumber
    ? parts.slice(2)
    : isCombinedStreetAddress
      ? parts.slice(1)
      : parts;
  const locality = localityCandidates.find((part) => !isNonLocality(part))
    ?? parts.find((part) => !isNonLocality(part))
    ?? parts[0];

  return LOCALITY_ALIASES[locality] ?? locality;
}