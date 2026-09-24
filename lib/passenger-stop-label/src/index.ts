const LOCALITY_ALIASES: Record<string, string> = {
  "Borough Park": "Boro Park",
};

export type PassengerStopIdentityInput = {
  kind: "pickup" | "dropoff" | "destination";
  label: string;
  lat: number;
  lng: number;
};

export const PUBLIC_PASSENGER_APP_URL = "https://coach-passenger-display.replit.app/passengers";

export function publicPassengerUrl(query: URLSearchParams | string) {
  const value = typeof query === "string" ? query.replace(/^\?/, "") : query.toString();
  return value ? `${PUBLIC_PASSENGER_APP_URL}?${value}` : PUBLIC_PASSENGER_APP_URL;
}

/**
 * Identifies a published physical stop across runs. API stop IDs deliberately
 * include run/order data, so they cannot be used to compare the same stop on
 * two departures. Coordinates, canonical passenger label, and stop role are
 * all included to avoid merging nearby or opposite-direction stops.
 */
export function passengerStopIdentity(stop: PassengerStopIdentityInput) {
  const label = stop.label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${stop.kind}|${stop.lat.toFixed(5)}|${stop.lng.toFixed(5)}|${label}`;
}

const NON_LOCALITY_PARTS = [
  /^United States(?: of America)?$/i,
  /^USA$/i,
  /^New York$/i,
  /^NY$/i,
  /^\d{5}(?:-\d{4})?$/,
  / County$/i,
  /^City of New York$/i,
];

const STREET_SUFFIX = "(?:Avenue|Ave|Street|St|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Parkway|Pkwy|Place|Pl|Court|Ct|Terrace|Ter|Highway|Hwy|Way)";
const STREET_PART = new RegExp(`\\b${STREET_SUFFIX}\\.?$`, "i");
const STREET_MENTION = new RegExp(
  `\\b(?:Route\\s+\\d+|(?:\\d+(?:st|nd|rd|th)|[A-Za-z][A-Za-z'.-]*)(?:\\s+[A-Za-z0-9][A-Za-z0-9'.-]*){0,2}?\\s+${STREET_SUFFIX})\\.?\\b`,
  "gi",
);

function isNonLocality(part: string) {
  return NON_LOCALITY_PARTS.some(pattern => pattern.test(part));
}

function isStreet(part: string) {
  return STREET_PART.test(part) || /^Route\s+\d+$/i.test(part);
}

function isPlainStreet(part: string) {
  return isStreet(part)
    && !/\b(?:beginning|route|right|left|then|goes?|continues?|starts?|picks?|drops?|stops?|leaves?)\b/i.test(
      part.replace(/^Route\s+\d+$/i, ""),
    );
}

function normalizeStreet(value: string) {
  return value
    .replace(/\b(?:State Highway|NY)\s+(\d+)\b/i, "Route $1")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:]$/, "")
    .replace(/\bAve\.?$/i, "Avenue")
    .replace(/\bSt\.?$/i, "Street")
    .replace(/\bRd\.?$/i, "Road")
    .replace(/\bBlvd\.?$/i, "Boulevard")
    .replace(/\bLn\.?$/i, "Lane")
    .replace(/\bDr\.?$/i, "Drive")
    .replace(/\bPkwy\.?$/i, "Parkway")
    .replace(/\bPl\.?$/i, "Place")
    .replace(/\bCt\.?$/i, "Court")
    .replace(/\bTer\.?$/i, "Terrace")
    .replace(/\bHwy\.?$/i, "Highway");
}

function narrativeStreetMentions(value: string) {
  const searchable = value
    .replace(/\b(?:this|the)\s+bus\b/gi, " ")
    .replace(/\bin\s+[A-Za-z][A-Za-z'.-]*\s+(?:at\s+)?(?=\d)/gi, " ")
    .replace(/\b(?:beginning|end)\s+of\s+(?:the\s+)?route\b/gi, " ")
    .replace(/\b(?:stop\s*\d+\s*:|starts?|picks?\s+up|drops?\s+off|stops?|turns?|left|right|then|continues?|goes?\s+(?:down|along)|leaves?|on\s+schedule(?:d)?\s+time)\b/gi, " ")
    .replace(/\b\d{1,3}\s*(?:minutes?|mins?\.?)\s*(?:prior\s+to|before)(?:\s+schedule(?:d)?\s+time)?\b/gi, " ")
    .replace(/\b(?:in\s+front\s+of|across\s+from|across|by|at|on)\b/gi, " ")
    .replace(/\b(?:corner|and)\b/gi, " ");
  const unique: string[] = [];
  for (const match of searchable.matchAll(STREET_MENTION)) {
    const street = normalizeStreet(match[0]);
    if (!unique.some(candidate => candidate.toLowerCase() === street.toLowerCase())) unique.push(street);
  }
  return unique;
}

/**
 * Produces a location label for passenger surfaces without changing the raw
 * address used by routing or geocoding. A verified label always wins; otherwise
 * two streets are shown only when both are explicitly present in the source.
 */
export function formatPassengerStopLabel(
  value: string,
  options: { verifiedLabel?: string | null; fallbackLabel?: string | null } = {},
) {
  const verified = options.verifiedLabel?.trim();
  if (verified) return verified;
  const input = value.trim();
  if (!input) return options.fallbackLabel?.trim() ?? "";

  const parts = input.split(",").map(part => part.trim()).filter(Boolean);
  const isSeparateHouseNumber = /^\d+[A-Z-]?$/i.test(parts[0] ?? "");
  const isCombinedStreetAddress = /^\d+[A-Z-]?\s/i.test(parts[0] ?? "");
  const streetStart = isSeparateHouseNumber ? 1 : 0;
  if (isPlainStreet(parts[streetStart] ?? "") && isPlainStreet(parts[streetStart + 1] ?? "")) {
    return `${normalizeStreet(parts[streetStart])} & ${normalizeStreet(parts[streetStart + 1])}`;
  }

  const acrossRoads = input.match(/^(?:picks?\s+up\s+)?(?:on\s+)?(.+?)\s+across\s+([^,.;(]+)(?:\s*\([^)]*\))?[.,;]?$/i);
  if (
    acrossRoads
    && !/\b(?:ohr\s+sameach|supermarket|savings|hospital|nursing\s+home|theater|hall|hub|shoes|sign|port\s+authority|park\s+and\s+ride)\b/i.test(acrossRoads[2])
  ) {
    const left = normalizeStreet(acrossRoads[1].replace(/^(?:at|on)\s+/i, ""));
    const right = normalizeStreet(acrossRoads[2]);
    if (left && right) return `${left} & ${right}`;
  }

  const streets = isSeparateHouseNumber || isCombinedStreetAddress ? [] : narrativeStreetMentions(input);
  if (streets.length >= 2) return `${streets[0]} & ${streets[1]}`;
  if (streets.length === 1) {
    return streets[0];
  }

  if (parts.length > 1) {
    const localityCandidates = isSeparateHouseNumber
      ? parts.slice(2)
      : isCombinedStreetAddress ? parts.slice(1) : parts;
    const locality = localityCandidates.find(part => !isNonLocality(part))
      ?? parts.find(part => !isNonLocality(part));
    if (locality) return LOCALITY_ALIASES[locality] ?? locality;
  }

  const narrativePlace = input
    .replace(/\b(?:beginning|end)\s+of\s+(?:the\s+)?route\b/gi, " ")
    .replace(/\b(?:starts?|picks?\s+up|drops?\s+off|stops?|then|continues?|leaves?)\b/gi, " ")
    .replace(/\b(?:(?:at|on)\s+schedule(?:d)?(?:\s+time)?|\d{1,3}\s*(?:minutes?|mins?\.?)\s*(?:prior\s+to|before)(?:\s+(?:the\s+)?schedule(?:d)?(?:\s+time)?)?)\b/gi, " ")
    .replace(/\b(?:at|on)\b/gi, " ")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/[.,;:]+/g, " ")
    .replace(/^\s*-\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (narrativePlace) return narrativePlace;

  const localityCandidates = isSeparateHouseNumber
    ? parts.slice(2)
    : isCombinedStreetAddress ? parts.slice(1) : parts;
  const locality = localityCandidates.find(part => !isNonLocality(part))
    ?? parts.find(part => !isNonLocality(part));
  return locality ? (LOCALITY_ALIASES[locality] ?? locality) : (options.fallbackLabel?.trim() ?? input);
}

/**
 * Keeps rider-relevant instructions from the official narrative separate from
 * the compact location label. Route-driving prose is deliberately ignored.
 */
export function extractPassengerStopNote(value: string, mainLabel = ""): string | undefined {
  const input = value.replace(/\s+/g, " ").trim();
  if (!input) return undefined;
  const notes: string[] = [];
  const add = (candidate: string | undefined) => {
    const note = candidate?.replace(/^[,.;:\s]+|[,.;:\s]+$/g, "").trim();
    if (!note || mainLabel.toLowerCase().includes(note.toLowerCase())) return;
    if (!notes.some(existing => existing.toLowerCase() === note.toLowerCase())) notes.push(note);
  };

  const landmark = input.match(/\b(across(?:\s+from)?|in\s+front\s+of|front\s+of|by|side\s+of)\s+([^,.;]+?)(?=\s+(?:\d{1,3}\s+minutes?|(?:at|on)\s+schedule)|[,.;]|$)/i);
  if (landmark) {
    const detail = landmark[2]
      .replace(/\s+at\s+the\s+bus\s+shelter\b/i, "")
      .replace(/\s*\(\s*corner\b[^)]*\)\s*$/i, "")
      .replace(/\s*\([^)]*\)\s*/g, "")
      .trim();
    add(`${landmark[1]} ${detail}`);
  }
  const shelter = input.match(/\b(?:at|by)\s+the\s+(bus\s+shelter)\b/i);
  if (shelter) add(shelter[1]);
  const timing = input.match(/\b(?:(?:at|on)\s+schedule(?:d)?(?:\s+time)?|\d{1,3}\s*(?:minutes?|mins?\.?)\s*(?:prior\s+to|before)(?:\s+(?:the\s+)?schedule(?:d)?(?:\s+time)?)?)\b/i);
  if (timing) add(timing[0]);
  const restriction = input.match(/\b(?:pick\s*up|pickup|drop\s*off|dropoff)\s+only\b|\bno\s+(?:pick\s*up|pickup|drop\s*off|dropoff)\b/i);
  if (restriction) add(restriction[0]);
  for (const match of input.matchAll(/\(([^)]+)\)/g)) {
    if (!/\bcorner\b/i.test(match[1])) add(match[1]);
  }

  return notes.length ? notes.join(" • ") : undefined;
}

export const formatPassengerDestination = formatPassengerStopLabel;