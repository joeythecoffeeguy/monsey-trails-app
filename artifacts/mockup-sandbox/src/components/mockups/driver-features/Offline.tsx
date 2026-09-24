import { SavedRouteView, type SavedDriverRoute } from './_SavedRouteView';
import './_group.css';

const route: SavedDriverRoute = {
  version: 1,
  driverSubject: 'sample-driver',
  coachNumber: '218',
  officialRunKey: '2025-09-23|1|1|7|sample-run',
  destinationAddress: 'Monsey Trails Terminal, 8 Washington Avenue, Spring Valley',
  destinationNote: 'Use the signed coach bay along Washington Avenue.',
  destination: { lat: 41.112, lng: -74.044 },
  stops: [
    {
      id: 'maple-306',
      address: 'Maple Avenue & Route 306',
      note: 'Board on Maple Avenue, across from the pharmacy entrance.',
      lat: 41.113,
      lng: -74.066,
    },
    {
      id: 'main-route59',
      address: 'Main Street & Route 59',
      note: 'Stop at the marked curb after the intersection.',
      lat: 41.111,
      lng: -74.058,
    },
    {
      id: 'shopping-center',
      address: 'Monsey Hub Shopping Center',
      note: 'Passenger pickup at the designated bus shelter.',
      lat: 41.109,
      lng: -74.051,
    },
  ],
  routeGeometry: [],
  savedAt: Date.parse('2025-09-23T14:05:00-04:00'),
  lastSuccessfulSyncAt: Date.parse('2025-09-23T14:05:00-04:00'),
  expiresAt: Date.parse('2025-09-24T14:05:00-04:00'),
};

export function Offline() {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute right-4 top-2 z-10 text-[11px] font-bold uppercase tracking-wider text-amber-900/60 sm:right-8">
        Sample saved route
      </div>
      <SavedRouteView route={route} />
    </div>
  );
}
