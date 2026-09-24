/**
 * Public data contract for the PassengerTripActivity Live Activity.
 * Keep this object JSON-serializable; these are the complete activity props.
 */
export type PassengerTripActivityPhase =
  | 'pickup'
  | 'onboard'
  | 'ended'
  | 'unavailable';

export type PassengerTripActivityProps = {
  phase: PassengerTripActivityPhase;
  lineName: string;
  stopName: string;
  etaLabel: string;
  coachNumber: string;
  status: string;
  updatedAt: string;
};