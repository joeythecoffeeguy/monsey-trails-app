import type {
  PassengerRealtimeSubscription,
  PassengerRealtimeSubscriptionInput,
  PassengerRealtimeSubscriptionInputFlow,
  PassengerTransferOption,
} from '@workspace/api-client-react';

export type RealtimeTransferOption = Pick<
  PassengerTransferOption,
  'runKey' | 'sharedStop' | 'bufferMinutes' | 'origin' | 'destination' | 'connectionStatus'
> & {
  /** Exact selected onward run, shared incoming stop, area and buffer. */
  onwardRunKey: string;
  incomingSharedStopId: string;
  areaId: number;
  minimumBufferMinutes: number;
};

export type RealtimeAlertIdentity = {
  passengerCode: string;
  deviceId: string;
  runKey: string;
  pickupStopId?: string;
};

/**
 * Caller must pass the currently selected active paired run. The server
 * revalidates that this run is active for this passenger code.
 */
export type RealtimeAlertsCardProps = RealtimeAlertIdentity & {
  transferOptions?: RealtimeTransferOption[];
  language?: 'en' | 'yi' | 'he';
};

export function canSubscribeToActivePairedRun(identity: RealtimeAlertIdentity) {
  return /^[0-9]{4}$/.test(identity.passengerCode)
    && identity.deviceId.trim().length > 0
    && identity.runKey.trim().length > 0;
}

export function buildRealtimeSubscriptionInput(
  identity: RealtimeAlertIdentity,
  flow: PassengerRealtimeSubscriptionInputFlow,
  expoPushToken: string,
  soundEnabled: boolean,
  transfer?: RealtimeTransferOption,
): PassengerRealtimeSubscriptionInput {
  if (!canSubscribeToActivePairedRun(identity)) {
    throw new Error('Realtime alerts are available only for an active paired passenger run.');
  }
  if (!expoPushToken.trim()) throw new Error('A push notification token is required to activate realtime alerts.');

  const common: PassengerRealtimeSubscriptionInput = {
    flow,
    passengerCode: identity.passengerCode,
    deviceId: identity.deviceId,
    expoPushToken,
    runKey: identity.runKey,
    soundEnabled,
  };

  if (flow === 'approaching-pickup') {
    if (!identity.pickupStopId) throw new Error('Choose a verified pickup stop before enabling pickup alerts.');
    return { ...common, selectedStopId: identity.pickupStopId };
  }

  if (flow === 'transfer-risk') {
    if (!transfer
      || !transfer.onwardRunKey
      || !transfer.incomingSharedStopId
      || !Number.isInteger(transfer.areaId)
      || transfer.areaId < 1
      || !Number.isInteger(transfer.minimumBufferMinutes)
      || transfer.minimumBufferMinutes < 5
      || transfer.minimumBufferMinutes > 120) {
      throw new Error('Select a valid published transfer and minimum connection buffer first.');
    }
    return {
      ...common,
      selectedStopId: transfer.incomingSharedStopId,
      onwardRunKey: transfer.onwardRunKey,
      transferAreaId: transfer.areaId,
      minimumBufferMinutes: transfer.minimumBufferMinutes,
    };
  }

  return common;
}

export function findRealtimeSubscription(
  subscriptions: PassengerRealtimeSubscription[],
  runKey: string,
  flow: PassengerRealtimeSubscriptionInputFlow,
  pickupStopId?: string,
  transfer?: RealtimeTransferOption,
) {
  return subscriptions.find(subscription => subscription.active
    && subscription.officialRunKey === runKey
    && subscription.flow === flow
    && (flow === 'disruption'
      || (flow === 'approaching-pickup' && !!pickupStopId && subscription.selectedStopId === pickupStopId)
      || (flow === 'transfer-risk' && !!transfer
        && subscription.selectedStopId === transfer.incomingSharedStopId
        && subscription.onwardRunKey === transfer.onwardRunKey
        && subscription.transferAreaId === transfer.areaId
        && subscription.minimumBufferMinutes === transfer.minimumBufferMinutes)));
}