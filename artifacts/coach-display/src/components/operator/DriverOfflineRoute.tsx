import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Bus, Clock3, MapPin, WifiOff } from 'lucide-react';
import { getOperatorBusNumber, useLiveTrip, useLiveTripRefreshStatus } from '@/providers/live-trip';
import {
  loadDriverOfflineRoute,
  saveDriverOfflineRoute,
  type SavedDriverRoute,
} from '@/lib/driver-offline-route';

function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  return online;
}

function formatSyncTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export function DriverOfflineProtection({
  driverSubject,
  children,
}: {
  driverSubject: string;
  children: ReactNode;
}) {
  const online = useOnlineStatus();
  const trip = useLiveTrip();
  const refresh = useLiveTripRefreshStatus();
  const coachNumber = getOperatorBusNumber();
  const [savedRoute, setSavedRoute] = useState<SavedDriverRoute | null>(() => (
    loadDriverOfflineRoute(driverSubject, coachNumber)
  ));

  useEffect(() => {
    if (!online || !refresh.lastSuccessfulRefreshAt || refresh.lastRefreshFailed) return;
    const saved = saveDriverOfflineRoute({
      driverSubject,
      coachNumber,
      trip,
      lastSuccessfulSyncAt: refresh.lastSuccessfulRefreshAt,
    });
    if (saved) setSavedRoute(saved);
  }, [
    coachNumber,
    driverSubject,
    online,
    refresh.lastRefreshFailed,
    refresh.lastSuccessfulRefreshAt,
    trip.destination,
    trip.destinationAddress,
    trip.destinationNote,
    trip.intermediateStops,
    trip.officialRunKey,
    trip.routeGeometry,
  ]);

  useEffect(() => {
    if (!online || refresh.lastRefreshFailed) {
      setSavedRoute(loadDriverOfflineRoute(driverSubject, getOperatorBusNumber()));
    }
  }, [driverSubject, online, refresh.lastRefreshFailed]);

  if ((online && !refresh.lastRefreshFailed) || !savedRoute) return children;
  return <SavedRouteView route={savedRoute} />;
}

export function SavedRouteView({ route }: { route: SavedDriverRoute }) {
  const destinations = [
    ...route.stops.map((stop) => ({ ...stop, final: false })),
    {
      id: 'offline-final-destination',
      address: route.destinationAddress,
      note: route.destinationNote,
      lat: route.destination.lat,
      lng: route.destination.lng,
      final: true,
    },
  ];

  return (
    <main className="operator-theme min-h-[100dvh] bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <section role="status" className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 shadow-sm dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <div className="flex items-start gap-3">
            <WifiOff className="mt-0.5 h-6 w-6 shrink-0" />
            <div>
              <h1 className="text-xl font-black">Offline — saved route</h1>
              <p className="mt-1 text-sm font-semibold">
                Read-only route for Coach {route.coachNumber}. Live traffic, dispatch updates, passenger status, and route changes are unavailable.
              </p>
              <p className="mt-3 flex items-center gap-1.5 text-xs font-bold">
                <Clock3 className="h-4 w-4" />
                Last successful sync: {formatSyncTime(route.lastSuccessfulSyncAt)}
              </p>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center gap-3 border-b border-border bg-muted/30 p-5">
            <Bus className="h-5 w-5 text-primary" />
            <div>
              <h2 className="font-black">Assigned route</h2>
              <p className="text-xs font-semibold text-muted-foreground">Saved for this driver, coach, and exact run only</p>
            </div>
          </div>
          <ol className="divide-y divide-border">
            {destinations.map((stop, index) => (
              <li key={stop.id} className="flex gap-4 p-5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-black text-primary">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">
                    {stop.final ? 'Final destination' : 'Stop'}
                  </p>
                  <p className="mt-1 font-bold">{stop.address}</p>
                  {stop.note && <p className="mt-1 text-sm text-muted-foreground">{stop.note}</p>}
                </div>
                <MapPin className="ml-auto h-5 w-5 shrink-0 text-muted-foreground" />
              </li>
            ))}
          </ol>
        </section>

        <section className="flex gap-3 rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
          <p>
            This saved copy cannot confirm current traffic or dispatch changes. Reconnect before starting, stopping, completing stops, or changing the route.
          </p>
        </section>
      </div>
    </main>
  );
}
