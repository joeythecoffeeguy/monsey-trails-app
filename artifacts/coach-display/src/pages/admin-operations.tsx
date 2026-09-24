import { useAuth } from '@clerk/react';
import { Link, Redirect } from 'wouter';
import {
  AlertTriangle,
  Bus,
  Clock3,
  ExternalLink,
  Loader2,
  MapPinOff,
  MonitorX,
  RadioTower,
  RefreshCw,
} from 'lucide-react';
import {
  getGetAdminOperationsExceptionsQueryKey,
  useGetAdminOperationsExceptions,
  type AdminOperationsException,
  type ErrorType,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { APP_ROUTES, appUrl } from '@/lib/app-routes';

const categoryDetails = {
  late_departure: { label: 'Late departure', icon: Clock3 },
  missing_gps: { label: 'Missing GPS', icon: MapPinOff },
  stale_gps: { label: 'Stale GPS', icon: RadioTower },
  disconnected_display: { label: 'Disconnected display', icon: MonitorX },
  active_disruption: { label: 'Active disruption', icon: AlertTriangle },
} as const;

const severityStyles = {
  critical: 'border-red-300 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100',
  warning: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100',
  info: 'border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100',
} as const;

function errorMessage(error: unknown) {
  const candidate = error as ErrorType<{ error?: string }>;
  return candidate?.data && typeof candidate.data === 'object' && candidate.data.error
    ? candidate.data.error
    : error instanceof Error ? error.message : 'Operations exceptions could not be loaded.';
}

function lastSeenLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : null;
}

function ExceptionCard({ item }: { item: AdminOperationsException }) {
  const detail = categoryDetails[item.type];
  const Icon = detail.icon;
  return (
    <article
      className={`rounded-xl border p-4 shadow-sm ${severityStyles[item.severity]}`}
      data-testid={`card-operation-exception-${item.id}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-wider">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-current/10 px-2.5 py-1">
              <Icon className="h-3.5 w-3.5" />
              {detail.label}
            </span>
            <span>{item.severity}</span>
          </div>
          <h2 className="text-lg font-black" data-testid={`text-operation-title-${item.id}`}>{item.title}</h2>
          <p className="mt-1 text-sm font-medium opacity-80">{item.detail}</p>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div><dt className="inline opacity-65">Coach </dt><dd className="inline font-bold">{item.busNumber}</dd></div>
            <div><dt className="inline opacity-65">Driver </dt><dd className="inline font-bold">{item.driverName || 'Name unavailable'}</dd></div>
            {item.direction && <div><dt className="inline opacity-65">Direction </dt><dd className="inline font-bold">{item.direction}</dd></div>}
            {lastSeenLabel(item.lastSeenAt) && <div><dt className="inline opacity-65">Last seen </dt><dd className="inline font-bold">{lastSeenLabel(item.lastSeenAt)}</dd></div>}
          </dl>
        </div>
        <Button asChild variant="outline" className="shrink-0 bg-background/80 text-foreground">
          <Link href={item.action.href} data-testid={`link-operation-action-${item.id}`}>
            {item.action.label}<ExternalLink className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </article>
  );
}

export default function AdminOperations() {
  const { isLoaded, userId } = useAuth();
  const query = useGetAdminOperationsExceptions({
    query: {
      queryKey: [...getGetAdminOperationsExceptionsQueryKey(), userId],
      enabled: Boolean(userId),
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
      staleTime: 10_000,
    },
  });

  if (!isLoaded) {
    return <div className="flex min-h-[100dvh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!userId) {
    return <Redirect to={`${appUrl('/sign-in')}?redirect_url=${encodeURIComponent(appUrl(APP_ROUTES.adminOperations))}`} />;
  }

  return (
    <div className="bg-muted/30 text-foreground">
      <main className="mx-auto max-w-7xl space-y-5 px-5 py-6">
        <div className="flex justify-end">
          <Button asChild variant="outline"><Link href={APP_ROUTES.adminIncidents} data-testid="link-operations-incidents">Open incident workflow</Link></Button>
        </div>
        {query.isLoading && !query.data && (
          <Card data-testid="status-operations-loading"><CardContent className="flex min-h-64 items-center justify-center gap-3"><Loader2 className="h-6 w-6 animate-spin" /> Loading active operations…</CardContent></Card>
        )}

        {query.isError && (
          <Card className="border-red-300" data-testid="status-operations-error">
            <CardContent className="flex min-h-64 flex-col items-center justify-center gap-4 text-center">
              <AlertTriangle className="h-9 w-9 text-red-600" />
              <div><h2 className="font-black">Operations data is unavailable</h2><p className="mt-1 text-sm text-muted-foreground">{errorMessage(query.error)}</p></div>
              <Button onClick={() => void query.refetch()} data-testid="button-retry-operations"><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
            </CardContent>
          </Card>
        )}

        {query.data && (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Operations summary">
              {[
                ['Active trips', query.data.summary.activeTrips],
                ['Critical', query.data.summary.critical],
                ['Late departures', query.data.summary.lateDepartures],
                ['GPS exceptions', query.data.summary.gps],
                ['Display exceptions', query.data.summary.disconnectedDisplays],
              ].map(([label, value]) => (
                <Card key={label} data-testid={`metric-${String(label).toLowerCase().replaceAll(' ', '-')}`}>
                  <CardContent className="p-4"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 text-3xl font-black">{value}</p></CardContent>
                </Card>
              ))}
            </section>

            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div><CardTitle>Needs attention</CardTitle><p className="mt-1 text-sm text-muted-foreground">Refreshes every 30 seconds from active assignments and live trip records.</p></div>
                <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching} data-testid="button-refresh-operations">
                  <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`} />Refresh
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {query.data.exceptions.map(item => <ExceptionCard key={item.id} item={item} />)}
                {query.data.exceptions.length === 0 && (
                  <div className="flex min-h-48 flex-col items-center justify-center text-center" data-testid="status-operations-empty">
                    <Bus className="mb-3 h-9 w-9 text-primary" />
                    <h2 className="font-black">No current trip exceptions</h2>
                    <p className="mt-1 max-w-lg text-sm text-muted-foreground">No late departure, GPS, or previously-seen passenger display issue is present in active trip data.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Service disruptions</CardTitle></CardHeader>
              <CardContent>
                <div className="rounded-lg border p-4 text-sm text-muted-foreground" data-testid="status-disruption-integration">
                  <p className="font-bold text-foreground">Structured notices connected</p>
                  <p className="mt-1">{query.data.disruptionIntegration.message}</p>
                </div>
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground" data-testid="text-operations-thresholds">
              Rules shown: departure still ready {query.data.thresholds.lateDepartureMinutes}+ minutes after schedule and critical after {query.data.thresholds.criticalLateDepartureMinutes} minutes; GPS stale after {query.data.thresholds.staleGpsMinutes} minutes and critical after {query.data.thresholds.criticalGpsMinutes} minutes. Updated {new Date(query.data.generatedAt).toLocaleTimeString()}.
            </p>
          </>
        )}
      </main>
    </div>
  );
}