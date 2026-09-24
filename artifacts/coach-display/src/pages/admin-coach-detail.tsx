import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { Link, Redirect, useParams } from 'wouter';
import {
  AlertTriangle,
  ArrowLeft,
  Bus,
  CheckCircle2,
  Clock3,
  History,
  Loader2,
  MapPin,
  MessageSquareText,
  RefreshCw,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { APP_ROUTES, appUrl } from '@/lib/app-routes';

type CoachDetail = {
  generatedAt: string;
  coach: {
    busNumber: string;
    label: string | null;
    notes: string | null;
    active: boolean;
    inactiveReason: string | null;
    returnToServiceDate: string | null;
  };
  assignment: {
    id: number;
    driverId: string;
    driverName: string | null;
    officialRunKey: string;
    direction: string;
    scheduledDepartureAt: string;
    assignedAt: string;
  } | null;
  trip: {
    status: string;
    destinationAddress: string;
    scheduledDepartureAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    updatedAt: string;
    gps: {
      lat: number | null;
      lng: number | null;
      speedMph: number | null;
      observedAt: string | null;
      ageMs: number | null;
      state: 'fresh' | 'stale' | 'missing';
    };
    display: {
      pairedScreenCount: number;
      lastSeenAt: string | null;
      state: 'connected' | 'recently_seen' | 'disconnected' | 'never_seen';
    };
  } | null;
  reports: Array<{
    id: string;
    assignmentId: number;
    category: string;
    location: { lat: number; lng: number };
    locationObservedAt: string;
    createdAt: string;
    resolvedAt: string | null;
    resolution: string | null;
  }>;
  instructions: Array<{
    id: string;
    assignmentId: number;
    message: string;
    createdAt: string;
    deliveredAt: string | null;
    acknowledgedAt: string | null;
  }>;
  notices: Array<{
    id: string;
    officialRunKey: string;
    type: string;
    message: string;
    startsAt: string;
    expiresAt: string;
    clearedAt: string | null;
  }>;
  history: Array<{
    id: number;
    driverId: string;
    driverName: string | null;
    serviceDate: string;
    direction: string;
    scheduledDepartureAt: string;
    assignedAt: string;
    endedAt: string | null;
    outcome: string;
  }>;
};

function dateTime(value: string | null) {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : 'Not recorded';
}

function ageLabel(ageMs: number | null) {
  if (ageMs === null) return 'No update received';
  if (ageMs < 60_000) return `${Math.max(1, Math.round(ageMs / 1000))} sec ago`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)} min ago`;
  return `${Math.round(ageMs / 3_600_000)} hr ago`;
}

function titleCase(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

export default function AdminCoachDetail() {
  const { busNumber = '' } = useParams<{ busNumber: string }>();
  const { isLoaded, userId, getToken } = useAuth();
  const [data, setData] = useState<CoachDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (background = false) => {
    if (!userId) return;
    if (!background) setLoading(true);
    try {
      const token = await getToken();
      const response = await fetch(`/api/admin/coaches/${encodeURIComponent(busNumber)}/detail`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await response.json().catch(() => ({})) as CoachDetail & { error?: string };
      if (!response.ok) throw new Error(body.error || `Coach details could not be loaded (${response.status}).`);
      setData(body);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Coach details could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [busNumber, getToken, userId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!isLoaded) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (!userId) {
    const destination = `/admin/coaches/${encodeURIComponent(busNumber)}`;
    return <Redirect to={`${appUrl('/sign-in')}?redirect_url=${encodeURIComponent(appUrl(destination))}`} />;
  }

  const gpsStyle = data?.trip?.gps.state === 'fresh'
    ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'
    : 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30';
  const currentRunNotices = data?.assignment
    ? data.notices.filter(item => item.officialRunKey === data.assignment?.officialRunKey)
    : [];

  return (
    <div className="min-h-screen bg-muted/30 text-foreground">
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">Fleet operations</p>
            <h1 className="text-2xl font-black">Coach {data?.coach.busNumber || busNumber.toUpperCase()}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link href={APP_ROUTES.adminDispatch}><ArrowLeft className="mr-2 h-4 w-4" />Dispatch board</Link></Button>
            <Button onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-5 py-6">
        {error && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive">
            <span><strong>Live details may be out of date.</strong> {error}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
          </div>
        )}
        {loading && !data && <Card><CardContent className="flex min-h-64 items-center justify-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />Loading coach details…</CardContent></Card>}

        {data && (
          <>
            <section className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Bus className="h-5 w-5" />Coach status</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p className="text-2xl font-black">{data.coach.active ? 'In service' : 'Inactive'}</p>
                  {!data.coach.active && <p>{data.coach.inactiveReason || 'No reason recorded'}{data.coach.returnToServiceDate ? ` · expected back ${data.coach.returnToServiceDate}` : ''}</p>}
                  {data.coach.label && <p><strong>Label:</strong> {data.coach.label}</p>}
                  {data.coach.notes && <p className="text-muted-foreground">{data.coach.notes}</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><UserRound className="h-5 w-5" />Driver & trip</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {data.assignment ? (
                    <>
                      <p className="text-lg font-black">{data.assignment.driverName || data.assignment.driverId}</p>
                      <p>{data.assignment.direction}</p>
                      <p className="text-muted-foreground">Scheduled {dateTime(data.assignment.scheduledDepartureAt)} · status <span className="font-bold capitalize">{data.trip?.status || 'assigned'}</span></p>
                      <div className="flex flex-wrap gap-2 pt-2">
                        <Button asChild size="sm"><Link href={APP_ROUTES.adminCommunications}>Message driver</Link></Button>
                        <Button asChild size="sm" variant="outline"><Link href={APP_ROUTES.admin}>Driver access</Link></Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="font-bold">No active assignment</p>
                      <p className="text-muted-foreground">Choose a published run, driver, and this coach on the dispatch board.</p>
                      <Button asChild size="sm"><Link href={APP_ROUTES.adminDispatch}>Assign coach</Link></Button>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className={gpsStyle}>
                <CardHeader><CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5" />GPS & display</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <p className="font-black">{data.trip ? titleCase(data.trip.gps.state) : 'No active trip'} GPS</p>
                    <p>{data.trip ? ageLabel(data.trip.gps.ageMs) : 'No trip telemetry'}</p>
                    {data.trip?.gps.lat !== null && data.trip?.gps.lat !== undefined && data.trip.gps.lng !== null && (
                      <p className="text-muted-foreground">{data.trip.gps.lat.toFixed(5)}, {data.trip.gps.lng.toFixed(5)}{data.trip.gps.speedMph === null ? '' : ` · ${Math.round(data.trip.gps.speedMph)} mph`}</p>
                    )}
                  </div>
                  <div className="border-t pt-3">
                    <p className="font-black">{data.trip ? titleCase(data.trip.display.state) : 'No display status'}</p>
                    <p>{data.trip?.display.pairedScreenCount ?? 0} paired screen{data.trip?.display.pairedScreenCount === 1 ? '' : 's'} · last seen {dateTime(data.trip?.display.lastSeenAt ?? null)}</p>
                    <Button asChild variant="outline" size="sm" className="mt-2"><Link href={APP_ROUTES.adminDisplay}>Open active displays</Link></Button>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" />Reports</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {data.reports.slice(0, 20).map(report => (
                    <article key={report.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-start justify-between gap-2"><strong>{titleCase(report.category)}</strong><span className={report.resolvedAt ? 'text-emerald-700' : 'text-amber-700'}>{report.resolvedAt ? 'Resolved' : 'Open'}</span></div>
                      <p className="text-muted-foreground">{dateTime(report.createdAt)}</p>
                      {report.resolution && <p className="mt-1">{report.resolution}</p>}
                    </article>
                  ))}
                  {data.reports.length === 0 && <p className="text-sm text-muted-foreground">No reports for this coach.</p>}
                  <Button asChild variant="outline" size="sm"><Link href={APP_ROUTES.adminCommunications}>Manage reports</Link></Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquareText className="h-5 w-5" />Messages</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {data.instructions.slice(0, 20).map(item => (
                    <article key={item.id} className="rounded-lg border p-3 text-sm">
                      <p className="font-semibold">{item.message}</p>
                      <p className="mt-1 text-muted-foreground">{dateTime(item.createdAt)}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs font-bold">{item.acknowledgedAt ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />Acknowledged</> : item.deliveredAt ? 'Delivered' : 'Awaiting delivery'}</p>
                    </article>
                  ))}
                  {data.instructions.length === 0 && <p className="text-sm text-muted-foreground">No dispatch messages for this coach.</p>}
                  <Button asChild variant="outline" size="sm"><Link href={APP_ROUTES.adminCommunications}>Send message</Link></Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5" />Current notices</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {currentRunNotices.map(item => (
                    <article key={item.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-start justify-between gap-2"><strong>{titleCase(item.type)}</strong><span>{item.clearedAt ? 'Cleared' : new Date(item.expiresAt).getTime() < Date.now() ? 'Expired' : 'Active'}</span></div>
                      <p className="mt-1">{item.message}</p>
                      <p className="mt-1 text-muted-foreground">Until {dateTime(item.expiresAt)}</p>
                    </article>
                  ))}
                  {currentRunNotices.length === 0 && <p className="text-sm text-muted-foreground">No notices for the current trip.</p>}
                  <Button asChild variant="outline" size="sm"><Link href={APP_ROUTES.adminDispatch}>Manage trip notice</Link></Button>
                </CardContent>
              </Card>
            </section>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />Assignment history</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead><tr className="border-b text-xs uppercase text-muted-foreground"><th className="p-2">Service date</th><th className="p-2">Driver</th><th className="p-2">Direction</th><th className="p-2">Departure</th><th className="p-2">Assigned</th><th className="p-2">Outcome</th></tr></thead>
                    <tbody>
                      {data.history.map(item => (
                        <tr key={item.id} className="border-b">
                          <td className="p-2">{item.serviceDate}</td>
                          <td className="p-2 font-semibold">{item.driverName || item.driverId}</td>
                          <td className="p-2">{item.direction}</td>
                          <td className="p-2">{dateTime(item.scheduledDepartureAt)}</td>
                          <td className="p-2">{dateTime(item.assignedAt)}</td>
                          <td className="p-2 capitalize">{item.endedAt ? item.outcome : 'Active'}</td>
                        </tr>
                      ))}
                      {data.history.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No assignment history for this coach.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground">Automatically refreshed every 15 seconds · server snapshot {dateTime(data.generatedAt)}.</p>
          </>
        )}
      </main>
    </div>
  );
}