type PassengerSession = {
  status: string;
};

export function shouldPollPassengerSession(
  trip: PassengerSession | null,
  passengerCode: string,
) {
  return Boolean(trip && passengerCode);
}

export function isDefinitivePassengerSessionExpiry(error: unknown) {
  if (!error || typeof error !== 'object' || !('status' in error)) return false;
  const status = (error as { status?: unknown }).status;
  return status === 404 || status === 410;
}