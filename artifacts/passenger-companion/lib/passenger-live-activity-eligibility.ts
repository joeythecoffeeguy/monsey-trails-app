export type PassengerLiveActivityOptInInput = {
  tripStatus: string | null | undefined;
  tripAssigned: boolean;
  tripSnapshotCurrent: boolean;
  publishedRunVerified: boolean;
  passengerCode: string | null | undefined;
  pickupStopId: string | null | undefined;
  dropoffStopId: string | null | undefined;
};

/** Opt-in is limited to a fresh, assigned, running, exact published run. */
export function canOptInToPassengerLiveActivity(input: PassengerLiveActivityOptInInput): boolean {
  return input.tripStatus === 'running'
    && input.tripAssigned
    && input.tripSnapshotCurrent
    && input.publishedRunVerified
    && /^\d{4}$/.test(input.passengerCode ?? '')
    && Boolean(input.pickupStopId)
    && Boolean(input.dropoffStopId)
    && input.pickupStopId !== input.dropoffStopId;
}