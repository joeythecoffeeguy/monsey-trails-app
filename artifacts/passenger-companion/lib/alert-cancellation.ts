export type PendingAlertCancellation = {
  version: 1;
  passengerCode: string;
  deviceId: string;
  leaveSession: boolean;
};

export function makePendingAlertCancellation(
  passengerCode: string,
  deviceId: string,
  leaveSession: boolean,
): PendingAlertCancellation {
  return { version: 1, passengerCode, deviceId, leaveSession };
}

export function parsePendingAlertCancellation(
  value: string | null,
): PendingAlertCancellation | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingAlertCancellation>;
    if (
      parsed.version === 1
      && typeof parsed.passengerCode === 'string'
      && /^\d{4}$/.test(parsed.passengerCode)
      && typeof parsed.deviceId === 'string'
      && parsed.deviceId.length > 0
      && typeof parsed.leaveSession === 'boolean'
    ) {
      return parsed as PendingAlertCancellation;
    }
  } catch {
    // Invalid persisted data is discarded by the caller.
  }
  return null;
}

export async function retryPendingAlertCancellation(
  cancellation: PendingAlertCancellation,
  waitUntilRegistrationsSettle: () => Promise<void>,
  deleteAlert: (value: PendingAlertCancellation) => Promise<void>,
  clearTombstone: () => Promise<void>,
) {
  try {
    // DELETE must be issued after every earlier PUT settles. Otherwise a slow registration can
    // recreate an alert after a newer cancellation has already succeeded.
    await waitUntilRegistrationsSettle();
    await deleteAlert(cancellation);
    await clearTombstone();
    return true;
  } catch {
    return false;
  }
}