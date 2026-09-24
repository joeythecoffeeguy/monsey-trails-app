const REGISTRATION_FAILURE_WINDOW_MS = 15 * 60_000;
const MAX_FAILURES_PER_IP = 40;
const MAX_FAILURES_PER_INSTALLATION = 10;

export const MAX_ACTIVE_LIVE_ACTIVITIES_PER_INSTALLATION = 10;
export const MAX_ACTIVE_LIVE_ACTIVITIES_PER_INSTALLATION_TRIP = 3;
export const MAX_ACTIVE_LIVE_ACTIVITIES_PER_TRIP = 500;

type FailureBucket = { windowStartedAt: number; failures: number };
const failedRegistrations = new Map<string, FailureBucket>();

function currentFailures(key: string, now: number) {
  const bucket = failedRegistrations.get(key);
  if (!bucket) return 0;
  if (now - bucket.windowStartedAt >= REGISTRATION_FAILURE_WINDOW_MS || now < bucket.windowStartedAt) {
    failedRegistrations.delete(key);
    return 0;
  }
  return bucket.failures;
}

function registrationFailureKeys(ipKey: string, installationKey: string | null) {
  return {
    ip: `ip:${ipKey}`,
    installation: installationKey ? `installation:${installationKey}` : null,
  };
}

export function passengerLiveActivityRegistrationAttemptAllowed(
  ipKey: string,
  installationKey: string | null,
  now = Date.now(),
) {
  const keys = registrationFailureKeys(ipKey, installationKey);
  return currentFailures(keys.ip, now) < MAX_FAILURES_PER_IP
    && (!keys.installation
      || currentFailures(keys.installation, now) < MAX_FAILURES_PER_INSTALLATION);
}

export function recordPassengerLiveActivityRegistrationFailure(
  ipKey: string,
  installationKey: string | null,
  now = Date.now(),
) {
  const keys = registrationFailureKeys(ipKey, installationKey);
  for (const key of [keys.ip, keys.installation]) {
    if (!key) continue;
    const bucket = failedRegistrations.get(key);
    if (!bucket || now - bucket.windowStartedAt >= REGISTRATION_FAILURE_WINDOW_MS
        || now < bucket.windowStartedAt) {
      failedRegistrations.set(key, { windowStartedAt: now, failures: 1 });
    } else {
      bucket.failures += 1;
    }
  }
  if (failedRegistrations.size > 10_000) {
    for (const [key, bucket] of failedRegistrations) {
      if (now - bucket.windowStartedAt >= REGISTRATION_FAILURE_WINDOW_MS
          || now < bucket.windowStartedAt) failedRegistrations.delete(key);
    }
  }
}

export function exceedsPassengerLiveActivityRegistrationLimits(counts: {
  installation: number;
  installationTrip: number;
  trip: number;
}) {
  return counts.installation >= MAX_ACTIVE_LIVE_ACTIVITIES_PER_INSTALLATION
    || counts.installationTrip >= MAX_ACTIVE_LIVE_ACTIVITIES_PER_INSTALLATION_TRIP
    || counts.trip >= MAX_ACTIVE_LIVE_ACTIVITIES_PER_TRIP;
}