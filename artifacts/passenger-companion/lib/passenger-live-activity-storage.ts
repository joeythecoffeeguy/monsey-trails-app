export type PassengerLiveActivityIdentity = {
  runKey: string;
  passengerCode: string;
  pickupStopId: string;
  dropoffStopId: string;
};

export type PassengerLiveActivityRecord = PassengerLiveActivityIdentity & {
  clientActivityId: string;
  serverId: string | null;
};

export const PASSENGER_LIVE_ACTIVITY_STORAGE_KEY = 'passenger.liveActivityMappings.v1';

export function isPassengerLiveActivityRecord(value: unknown): value is PassengerLiveActivityRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PassengerLiveActivityRecord>;
  return typeof record.clientActivityId === 'string'
    && record.clientActivityId.length > 0
    && (record.serverId === null || typeof record.serverId === 'string')
    && typeof record.runKey === 'string'
    && typeof record.passengerCode === 'string'
    && typeof record.pickupStopId === 'string'
    && typeof record.dropoffStopId === 'string';
}

export function parsePassengerLiveActivityRecords(json: string | null): PassengerLiveActivityRecord[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter(isPassengerLiveActivityRecord) : [];
  } catch {
    return [];
  }
}

export function passengerLiveActivityMatchesIdentity(
  record: PassengerLiveActivityIdentity,
  identity: PassengerLiveActivityIdentity,
): boolean {
  return record.runKey === identity.runKey
    && record.passengerCode === identity.passengerCode
    && record.pickupStopId === identity.pickupStopId
    && record.dropoffStopId === identity.dropoffStopId;
}

export function upsertPassengerLiveActivityRecord(
  records: PassengerLiveActivityRecord[],
  next: PassengerLiveActivityRecord,
): PassengerLiveActivityRecord[] {
  return [...records.filter(record => record.clientActivityId !== next.clientActivityId), next];
}

export function removePassengerLiveActivityRecord(
  records: PassengerLiveActivityRecord[],
  clientActivityId: string,
): PassengerLiveActivityRecord[] {
  return records.filter(record => record.clientActivityId !== clientActivityId);
}