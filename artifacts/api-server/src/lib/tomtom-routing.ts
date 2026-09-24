const PROVIDER_DENIAL_COOLDOWN_MS = 5 * 60_000;
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const TRANSIENT_FAILURE_COOLDOWN_MS = 15_000;
const VERIFIED_PROVIDER_TTL_MS = 5 * 60_000;

let unavailableUntil = 0;
let verifiedUntil = 0;
let verificationInFlight: Promise<void> | null = null;

export class TomTomRoutingUnavailableError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds: number,
  ) {
    super(`TomTom routing is unavailable (${status})`);
    this.name = "TomTomRoutingUnavailableError";
  }
}

function cooldownForStatus(status: number) {
  if (status === 401 || status === 403) return PROVIDER_DENIAL_COOLDOWN_MS;
  if (status === 429) return RATE_LIMIT_COOLDOWN_MS;
  return status >= 500 ? TRANSIENT_FAILURE_COOLDOWN_MS : 0;
}

function remainingCooldownSeconds(now = Date.now()) {
  return Math.max(1, Math.ceil((unavailableUntil - now) / 1_000));
}

export async function fetchTomTomRoute(url: string, timeoutMs = 12_000) {
  const now = Date.now();
  if (now < unavailableUntil) {
    throw new TomTomRoutingUnavailableError(503, remainingCooldownSeconds(now));
  }

  if (now >= verifiedUntil) {
    if (verificationInFlight) {
      await verificationInFlight;
      return fetchTomTomRoute(url, timeoutMs);
    }

    const verificationRequest = requestTomTomRoute(url, timeoutMs);
    verificationInFlight = verificationRequest.then(() => {
      verifiedUntil = Date.now() + VERIFIED_PROVIDER_TTL_MS;
    }, () => undefined);
    try {
      return await verificationRequest;
    } finally {
      verificationInFlight = null;
    }
  }

  return requestTomTomRoute(url, timeoutMs);
}

async function requestTomTomRoute(url: string, timeoutMs: number) {
  const now = Date.now();
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    unavailableUntil = Math.max(unavailableUntil, now + TRANSIENT_FAILURE_COOLDOWN_MS);
    verifiedUntil = 0;
    throw error;
  }
  if (response.ok) return response;

  const cooldownMs = cooldownForStatus(response.status);
  if (cooldownMs > 0) {
    unavailableUntil = Math.max(unavailableUntil, now + cooldownMs);
    verifiedUntil = 0;
  }
  throw new TomTomRoutingUnavailableError(
    response.status,
    cooldownMs > 0 ? Math.ceil(cooldownMs / 1_000) : 1,
  );
}

export function clearTomTomRoutingCooldownForTest() {
  unavailableUntil = 0;
  verifiedUntil = 0;
  verificationInFlight = null;
}