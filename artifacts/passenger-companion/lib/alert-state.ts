export type AlertLeadTime = 'time-15m' | 'time-5m' | 'time-2m' | 'arriving-now' | 'distance-0.5mi';
export type AlertSelection = {
  version: 2;
  operatorPairingCode: string;
  passengerCode: string;
  selectedStopId: string;
  leadTime: AlertLeadTime;
  soundEnabled: boolean;
};

type SnapshotIdentity = {
  operatorPairingCode: string;
  passengerCode: string;
  active: boolean;
  upcomingStops: { id: string }[];
};

export function isRestorableAlert(
  selection: AlertSelection | null,
  trip: SnapshotIdentity,
): selection is AlertSelection {
  return Boolean(
    selection?.version === 2 &&
    selection.operatorPairingCode === trip.operatorPairingCode &&
    selection.passengerCode === trip.passengerCode &&
    trip.active &&
    trip.upcomingStops.some((stop) => stop.id === selection.selectedStopId),
  );
}

export function makeAlertSelection(
  trip: Pick<SnapshotIdentity, 'operatorPairingCode' | 'passengerCode'>,
  selectedStopId: string,
  leadTime: AlertLeadTime,
  soundEnabled: boolean,
): AlertSelection {
  return { version: 2, operatorPairingCode: trip.operatorPairingCode, passengerCode: trip.passengerCode, selectedStopId, leadTime, soundEnabled };
}

export function alertPayload(selection: AlertSelection, deviceId: string, expoPushToken: string) {
  return { passengerCode: selection.passengerCode, deviceId, expoPushToken, selectedStopId: selection.selectedStopId, leadTime: selection.leadTime, soundEnabled: selection.soundEnabled };
}