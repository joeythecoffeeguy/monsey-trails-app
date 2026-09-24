import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import { Link, Redirect } from 'wouter';
import {
  AlertTriangle,
  ArrowRight,
  Bus,
  CircleAlert,
  Clock3,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Route,
} from 'lucide-react';
import {
  getGetAdminOperationsExceptionsQueryKey,
  useGetAdminOperationsExceptions,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAdminFilters, useAdminRole } from '@/components/admin/AdminLayout';
import { APP_ROUTES, appUrl } from '@/lib/app-routes';

type Assignment = {
  id: number;
  busNumber: string;
  driverName: string | null;
  serviceDate: string;
  direction: string;
  status: string;
  scheduledDepartureAt: string | null;
  completedAt: string | null;
};

type Communications = {
  reports: Array<{
    id: string;
    busNumber: string;
    category: string;
    createdAt: string;
    resolvedAt: string | null;
  }>;
};

function dateInNewYork(value: string) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    : '';
}

function timeLabel(value: string | null) {
  if (!value) return 'Time unavailable';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
    : 'Time unavailable';
}

export default function AdminOverview() {
  const { isLoaded, userId, getToken } = useAuth();
  const { serviceDate } = useAdminFilters();
  const role = useAdminRole();
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [communications, setCommunications] = useState<Communications | null>(null);
  const [supportError, setSupportError] = useState('');
  const [supportLoading, setSupportLoading] = useState(true);

  const operations = useGetAdminOperationsExceptions({
    query: {
      queryKey: [...getGetAdminOperationsExceptionsQueryKey(), userId],
      enabled: Boolean(userId && role && role !== 'content'),
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
      staleTime: 10_000,
    },
  });

  const request = useCallback(async <T,>(path: string) => {
    const token = await getToken();
    const response = await fetch(`/api${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || `Request failed (${response.status}).`);
    }
    return response.json() as Promise<T>;
  }, [getToken]);

  const loadSupportData = useCallback(async () => {
    setSupportLoading(true);
    try {
      const [nextAssignments, nextCommunications] = await Promise.all([
        request<Assignment[]>('/admin/dispatch-assignments?active=true'),
        request<Communications>('/admin/communications'),
      ]);
      setAssignments(nextAssignments);
      setCommunications(nextCommunications);
      setSupportError('');
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : 'Today’s operating data could not be refreshed.');
    } finally {
      setSupportLoading(false);
    }
  }, [request]);

  useEffect(() => {
    if (!userId || !role || role === 'content') return;
    void loadSupportData();
    const timer = window.setInterval(() => void loadSupportData(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadSupportData, role, userId]);

  const datedAssignments = useMemo(
    () => assignments?.filter(item => item.serviceDate === serviceDate && !item.completedAt) ?? [],
    [assignments, serviceDate],
  );
  const datedReports = useMemo(
    () => communications?.reports.filter(item => dateInNewYork(item.createdAt) === serviceDate) ?? [],
    [communications, serviceDate],
  );
  const openReports = datedReports.filter(item => !item.resolvedAt);

  if (!isLoaded) {
    return <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }
  if (!userId) {
    return <Redirect to={`${appUrl('/sign-in')}?redirect_url=${encodeURIComponent(appUrl(APP_ROUTES.adminOverview))}`} />;
  }
  if (!role) {
    return <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }
  if (role === 'content') {
    return (
      <main className="mx-auto max-w-5xl space-y-5 p-5 lg:p-8" data-testid="admin-overview">
        <p className="text-sm font-semibold text-muted-foreground">Manage passenger-facing information for {serviceDate}.</p>
        <div className="grid gap-4 md:grid-cols-3">
          <Card><CardHeader><CardTitle>Communications</CardTitle></CardHeader><CardContent><p className="mb-4 text-sm text-muted-foreground">Publish approved passenger notices for affected departures.</p><Button asChild><Link href={APP_ROUTES.adminCommunications}>Open communications</Link></Button></CardContent></Card>
          <Card><CardHeader><CardTitle>Displays</CardTitle></CardHeader><CardContent><p className="mb-4 text-sm text-muted-foreground">Manage normal passenger display slides and announcements.</p><Button asChild><Link href={APP_ROUTES.adminDisplay}>Open displays</Link></Button></CardContent></Card>
          <Card><CardHeader><CardTitle>Stops</CardTitle></CardHeader><CardContent><p className="mb-4 text-sm text-muted-foreground">Review passenger stop names, locations, and queued changes.</p><Button asChild><Link href={APP_ROUTES.adminStops}>Open stops</Link></Button></CardContent></Card>
        </div>
      </main>
    );
  }

  const hasInitialData = assignments !== null || communications !== null || operations.data;
  const refreshing = supportLoading || operations.isFetching;

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-5 lg:p-8" data-testid="admin-overview">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-muted-foreground">A live view of assignments, exceptions, and driver reports for {serviceDate}.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={() => { void operations.refetch(); void loadSupportData(); }}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh
        </Button>
      </div>

      {(supportError || operations.isError) && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-black">Some live data could not be refreshed</p>
            <p className="text-sm">{supportError || 'Operations exceptions are temporarily unavailable.'} Existing results remain visible where available.</p>
          </div>
        </div>
      )}

      {!hasInitialData && refreshing ? (
        <Card><CardContent className="flex min-h-64 items-center justify-center gap-3"><Loader2 className="h-6 w-6 animate-spin" />Loading today’s operations…</CardContent></Card>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Today summary">
            {[
              { label: 'Active assignments', value: datedAssignments.length, icon: Route },
              { label: 'Active trips', value: operations.data?.summary.activeTrips ?? null, icon: Bus },
              { label: 'Needs attention', value: operations.data?.summary.total ?? null, icon: AlertTriangle },
              { label: 'Open driver reports', value: communications ? openReports.length : null, icon: MessageSquareText },
            ].map(metric => (
              <Card key={metric.label}>
                <CardContent className="flex items-start justify-between p-5">
                  <div><p className="text-xs font-black uppercase tracking-wider text-muted-foreground">{metric.label}</p><p className="mt-2 text-3xl font-black">{metric.value ?? '—'}</p></div>
                  <metric.icon className="h-5 w-5 text-primary" />
                </CardContent>
              </Card>
            ))}
          </section>

          <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Today’s assignments</CardTitle>
                <Button asChild variant="ghost" size="sm"><Link href={APP_ROUTES.adminDispatch}>Open dispatch<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {datedAssignments.map(item => (
                  <Link
                    key={item.id}
                    href={`/admin/coaches/${encodeURIComponent(item.busNumber)}`}
                    className="flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
                  >
                    <div className="min-w-0">
                      <p className="font-black">Coach {item.busNumber}</p>
                      <p className="truncate text-sm text-muted-foreground">{item.driverName || 'Driver name unavailable'} · {item.direction || 'Direction unavailable'}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold capitalize">{item.status}</p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3 w-3" />{timeLabel(item.scheduledDepartureAt)}</p>
                    </div>
                  </Link>
                ))}
                {assignments && datedAssignments.length === 0 && (
                  <div className="rounded-xl border border-dashed p-8 text-center">
                    <p className="font-black">No active assignments for this service date</p>
                    <p className="mt-1 text-sm text-muted-foreground">Choose another date or open dispatch to assign a published run.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Needs attention</CardTitle>
                <Button asChild variant="ghost" size="sm"><Link href={APP_ROUTES.adminOperations}>All exceptions<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {operations.data?.exceptions.slice(0, 6).map(item => (
                  <Link
                    key={item.id}
                    href={`/admin/coaches/${encodeURIComponent(item.busNumber)}`}
                    className="block rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-amber-950 transition-colors hover:bg-amber-100"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-black">{item.title}</p><p className="mt-1 text-sm opacity-80">{item.detail}</p></div>
                      <span className="rounded-full bg-amber-200 px-2 py-1 text-[10px] font-black uppercase">{item.severity}</span>
                    </div>
                  </Link>
                ))}
                {operations.data && operations.data.exceptions.length === 0 && (
                  <div className="rounded-xl border border-dashed p-8 text-center">
                    <p className="font-black">No current trip exceptions</p>
                    <p className="mt-1 text-sm text-muted-foreground">No late departure, GPS, display, or active disruption exception is present.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Driver reports</CardTitle>
              <Button asChild variant="ghost" size="sm"><Link href={APP_ROUTES.adminCommunications}>Open communications<ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {openReports.slice(0, 6).map(report => (
                <Link key={report.id} href={`/admin/coaches/${encodeURIComponent(report.busNumber)}`} className="rounded-xl border p-3 hover:border-primary/40 hover:bg-primary/5">
                  <p className="font-black capitalize">{report.category.replaceAll('_', ' ')}</p>
                  <p className="text-sm text-muted-foreground">Coach {report.busNumber} · {timeLabel(report.createdAt)}</p>
                </Link>
              ))}
              {communications && openReports.length === 0 && <p className="text-sm text-muted-foreground">No open driver reports for this service date.</p>}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}