import { passengerStopIdentity } from '@workspace/passenger-stop-label';

export type ServingStop = {
  id: string;
  kind: 'pickup' | 'dropoff' | 'destination';
  label: string;
  lat: number;
  lng: number;
};

export type StopSelection = Pick<ServingStop, 'kind' | 'label' | 'lat' | 'lng'>;

export function filterItemsServingExactStops<T>(
  items: Array<{ value: T; stops: ServingStop[] }>,
  pickup: StopSelection,
  dropoff: StopSelection,
) {
  return items
    .filter(item => {
      const pickupIndex = item.stops.findIndex(stop =>
        stop.kind === 'pickup' && passengerStopIdentity(stop) === passengerStopIdentity(pickup));
      const dropoffIndex = item.stops.findIndex(stop =>
        stop.kind === 'dropoff' && passengerStopIdentity(stop) === passengerStopIdentity(dropoff));
      return pickupIndex >= 0 && dropoffIndex > pickupIndex;
    })
    .map(item => item.value);
}