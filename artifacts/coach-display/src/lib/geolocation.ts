export class GeolocationRequestError extends Error {
  constructor(
    message: string,
    public readonly code: number,
  ) {
    super(message);
    this.name = 'GeolocationRequestError';
  }
}

export function requestCurrentPosition(
  geolocation: Geolocation | undefined = navigator.geolocation,
  options: PositionOptions = {
    enableHighAccuracy: true,
    maximumAge: 5_000,
    timeout: 15_000,
  },
): Promise<GeolocationPosition> {
  if (!geolocation) {
    return Promise.reject(new GeolocationRequestError('This device does not support GPS location.', 0));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      callback();
    };
    geolocation.getCurrentPosition(
      (position) => finish(() => resolve(position)),
      (positionError) => {
        finish(() => reject(new GeolocationRequestError(
          positionError.message || 'Location permission was denied or GPS is unavailable.',
          positionError.code,
        )));
      },
      options,
    );
    if (!settled) {
      timeoutId = setTimeout(() => {
        finish(() => reject(new GeolocationRequestError(
          'GPS did not respond. Check that location services are enabled, then retry.',
          3,
        )));
      }, options.timeout ?? 15_000);
    }
  });
}