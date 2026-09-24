import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import { Link } from 'wouter';
import { Bus, CalendarDays, History, Loader2, LogOut, Play, RefreshCw, Route, ShieldAlert, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { APP_ROUTES } from '@/lib/app-routes';
import {
  BUS_LINES,
  SERVICE_AREAS,
  createOfficialRunKey,
  fetchOfficialSchedule,
  type OfficialSchedule,
} from '@/providers/official-schedules';
import { ScheduleKeyBadges, ScheduleKeyLegend } from '@/components/schedule-keys';
import { NewYorkSchedulePdf } from '@/components/new-york-schedule-pdf';
import { DisruptionEditor } from '@/components/admin/DisruptionEditor';
import { DispatchCommunications } from '@/components/admin/DispatchCommunications';
import { useAdminFilters } from '@/components/admin/AdminLayout';

type AdminDriver = {
  id: string;
  displayName?: string | null;
  username?: string | null;
  unitNumber?: string | null;
  banned?: boolean;
  locked?: boolean;
  disabled?: boolean;
};

export type DispatchAssignment = {
  id: number;
  busNumber: string;
  driverId: string | null;
  driverName: string | null;
  officialRunKey: string | null;
  serviceDate: string;
  direction: string;
  status: string;
  scheduledDepartureAt: string | null;
  assignedAt: string;
  completedAt: string | null;
};

type FleetCoach = {
  busNumber: string;
  label: string | null;
  notes: string | null;
  active: boolean;
  inactiveReason: string | null;
  returnToServiceDate: string | null;
};

type AdminActiveTrip = {
  busNumber: string;
  pairedScreenCount: number;
};

/**
 * Assignment history is a separate API result from the active-assignment
 * result. Keep the identity deliberately strict: departure time and display
 * direction are not unique enough to identify a published run.
 */
function sameOfficialRunKey(left: string | null, right: string | null) {
  if (!left || !right) return false;
  const leftParts = left.trim().split('|');
  const rightParts = right.trim().split('|');
  return leftParts.length === 5
    && rightParts.length === 5
    && leftParts.every((part, index) => part.length > 0 && part === rightParts[index]);
}

export function historyWithoutVisibleActiveAssignments(
  history: DispatchAssignment[],
  visibleActive: DispatchAssignment[],
  currentRunKeys: string[],
) {
  const visible = new Set(
    visibleActive
      .filter(active => currentRunKeys.some(key => sameOfficialRunKey(active.officialRunKey, key)))
      .map(active => `${active.id}|${active.busNumber}|${active.officialRunKey ?? ''}`),
  );
  return history.filter(item => !visible.has(`${item.id}|${item.busNumber}|${item.officialRunKey ?? ''}`));
}

export function assignmentSelectionConflict(
  driverId: string,
  busNumber: string,
  activeAssignments: DispatchAssignment[],
) {
  const normalizedBus = busNumber.trim().toUpperCase();
  const driver = driverId
    ? activeAssignments.find(item => !item.completedAt && item.driverId === driverId)
    : undefined;
  const coach = normalizedBus
    ? activeAssignments.find(item => !item.completedAt && item.busNumber === normalizedBus)
    : undefined;
  return { driver, coach, conflict: driver || coach };
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const timeLabel = (value: string) => {
  const trimmed = value.trim().replace(/\.(\d{3})\d+(?=Z|[+-]\d{2}:\d{2}$)/, '.$1');
  const iso = trimmed.includes('T') ? new Date(trimmed) : null;
  if (iso && Number.isFinite(iso.getTime())) {
    return iso.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  }
  const match = /^(\d{1,2}):([0-5]\d)/.exec(trimmed);
  if (!match) return 'unavailable';
  return new Date(`2000-01-01T${String(Number(match[1]) % 24).padStart(2, '0')}:${match[2]}:00Z`)
    .toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
};

export default function AdminDispatch() {
  const { isLoaded, userId, getToken } = useAuth();
  const { serviceDate: date, setServiceDate: setDate } = useAdminFilters();
  const [line, setLine] = useState(1);
  const [origin, setOrigin] = useState(3);
  const [destination, setDestination] = useState(2);
  const [schedule, setSchedule] = useState<OfficialSchedule | null>(null);
  const [drivers, setDrivers] = useState<AdminDriver[]>([]);
  const [assignments, setAssignments] = useState<DispatchAssignment[]>([]);
  const [activeAssignments, setActiveAssignments] = useState<DispatchAssignment[]>([]);
  const [activeTrips, setActiveTrips] = useState<AdminActiveTrip[]>([]);
  const [coaches, setCoaches] = useState<FleetCoach[]>([]);
  const [newCoach, setNewCoach] = useState('');
  const [inactiveCoach, setInactiveCoach] = useState<FleetCoach | null>(null);
  const [inactiveReason, setInactiveReason] = useState('');
  const [returnToServiceDate, setReturnToServiceDate] = useState('');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [historyCoach, setHistoryCoach] = useState('');
  const [historyDriver, setHistoryDriver] = useState('');
  const [historyDirection, setHistoryDirection] = useState('');
  const [historyState, setHistoryState] = useState('all');
  const [driverByRun, setDriverByRun] = useState<Record<string, string>>({});
  const [busByRun, setBusByRun] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [savingRun, setSavingRun] = useState('');
  const [controllingBus, setControllingBus] = useState('');
  const [disconnectingBus, setDisconnectingBus] = useState('');
  const [error, setError] = useState('');
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  const areas = useMemo(() => SERVICE_AREAS.filter(area => area.lines.includes(line)), [line]);
  const destinationOptions = useMemo(() => areas.filter(area => area.id !== origin), [areas, origin]);
  const activeDrivers = drivers.filter(driver => !driver.disabled && !driver.banned && !driver.locked);
  const currentRunKeys = schedule?.runs.map(run => createOfficialRunKey({
    date,
    line,
    origin,
    destination,
    runId: run.id,
  })) ?? [];
  const visibleHistory = historyWithoutVisibleActiveAssignments(assignments, activeAssignments, currentRunKeys);

  async function adminRequest<T>(path: string, init?: RequestInit) {
    const token = await getToken();
    const response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || `Request failed (${response.status})`);
    }
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }

  async function loadBoard(background = false) {
    if (!background) setLoading(true);
    try {
      const historyParams = new URLSearchParams();
      if (historyFrom) historyParams.set('from', historyFrom);
      if (historyTo) historyParams.set('to', historyTo);
      if (historyCoach) historyParams.set('coach', historyCoach);
      if (historyDriver) historyParams.set('driver', historyDriver);
      if (historyDirection) historyParams.set('direction', historyDirection);
      if (historyState !== 'all') historyParams.set('active', String(historyState === 'active'));
      const [nextSchedule, driverPage, nextAssignments, nextActiveAssignments, nextActiveTrips, nextCoaches] = await Promise.all([
        fetchOfficialSchedule(line, origin, destination, date),
        adminRequest<{ drivers: AdminDriver[] }>('/admin/drivers'),
        adminRequest<DispatchAssignment[]>(`/admin/dispatch-assignments?${historyParams}`),
        adminRequest<DispatchAssignment[]>('/admin/dispatch-assignments?active=true'),
        adminRequest<AdminActiveTrip[]>('/admin/active-trips'),
        adminRequest<FleetCoach[]>('/admin/coaches'),
      ]);
      setSchedule(nextSchedule);
      setDrivers(driverPage.drivers);
      setAssignments(nextAssignments);
      setActiveAssignments(nextActiveAssignments);
      setActiveTrips(nextActiveTrips);
      setCoaches(nextCoaches);
      setRefreshedAt(new Date());
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Dispatch board could not be loaded.');
    } finally {
      if (!background) setLoading(false);
    }
  }

  useEffect(() => {
    if (isLoaded && userId) void loadBoard();
  }, [isLoaded, userId]);

  useEffect(() => {
    if (!isLoaded || !userId) return;
    const timer = window.setInterval(() => void loadBoard(true), 15_000);
    return () => window.clearInterval(timer);
  }, [isLoaded, userId, date, line, origin, destination, historyFrom, historyTo, historyCoach, historyDriver, historyDirection, historyState]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  function changeLine(nextLine: number) {
    setLine(nextLine);
    const defaults = nextLine === 3 ? [3, 7] : nextLine === 2 ? [2, 10] : [3, 2];
    setOrigin(defaults[0]);
    setDestination(defaults[1]);
    setSchedule(null);
  }

  function changeOrigin(nextOrigin: number) {
    setOrigin(nextOrigin);
    const next = areas.find(area => area.id !== nextOrigin);
    if (next) setDestination(next.id);
    setSchedule(null);
  }

  async function assign(runId: string) {
    const officialRunKey = createOfficialRunKey({ date, line, origin, destination, runId });
    const driverId = driverByRun[runId];
    const busNumber = busByRun[runId]?.trim().toUpperCase();
    if (!driverId || !busNumber) {
      toast.error('Choose a driver and enter a coach number.');
      return;
    }
    setSavingRun(runId);
    try {
      await adminRequest('/admin/dispatch-assignments', {
        method: 'POST',
        body: JSON.stringify({ officialRunKey, driverId, busNumber }),
      });
      toast.success('Driver, coach, and published schedule assigned together.');
      await loadBoard();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Assignment could not be saved.');
    } finally {
      setSavingRun('');
    }
  }

  async function unassign(busNumber: string) {
    try {
      await adminRequest(`/admin/dispatch-assignments/${encodeURIComponent(busNumber)}`, { method: 'DELETE' });
      toast.success('Assignment released.');
      await loadBoard();
    } catch (releaseError) {
      toast.error(releaseError instanceof Error ? releaseError.message : 'Assignment could not be released.');
    }
  }

  async function controlTrip(busNumber: string, action: 'start' | 'stop') {
    setControllingBus(busNumber);
    try {
      await adminRequest(`/admin/active-trips/${encodeURIComponent(busNumber)}/${action}`, { method: 'POST' });
      toast.success(action === 'start'
        ? `Coach ${busNumber} started. Passenger tracking will begin with the driver's next GPS update.`
        : `Coach ${busNumber} stopped. Its location is now hidden from passengers.`);
      await loadBoard();
    } catch (controlError) {
      toast.error(controlError instanceof Error ? controlError.message : `Trip could not be ${action === 'start' ? 'started' : 'stopped'}.`);
    } finally {
      setControllingBus('');
    }
  }

  async function disconnectScreens(busNumber: string) {
    setDisconnectingBus(busNumber);
    try {
      const result = await adminRequest<{ disconnectedScreenCount: number }>(
        `/admin/active-trips/${encodeURIComponent(busNumber)}/disconnect-screens`,
        { method: 'POST' },
      );
      toast.success(result.disconnectedScreenCount === 1
        ? `1 paired screen on coach ${busNumber} was logged out.`
        : `${result.disconnectedScreenCount} paired screens on coach ${busNumber} were logged out.`);
      await loadBoard();
    } catch (disconnectError) {
      toast.error(disconnectError instanceof Error ? disconnectError.message : 'Paired screens could not be logged out.');
    } finally {
      setDisconnectingBus('');
    }
  }

  async function saveCoach() {
    const busNumber = newCoach.trim().toUpperCase();
    if (!busNumber) return;
    try {
      await adminRequest('/admin/coaches', { method: 'POST', body: JSON.stringify({ busNumber }) });
      setNewCoach('');
      toast.success(`Coach ${busNumber} saved.`);
      await loadBoard();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Coach could not be saved.');
    }
  }

  async function setCoachActive(
    coach: FleetCoach,
    active: boolean,
    details?: { inactiveReason: string; returnToServiceDate: string },
  ) {
    try {
      await adminRequest(`/admin/coaches/${encodeURIComponent(coach.busNumber)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          active,
          ...(details ? {
            inactiveReason: details.inactiveReason,
            returnToServiceDate: details.returnToServiceDate || null,
          } : {}),
        }),
      });
      toast.success(`Coach ${coach.busNumber} marked ${active ? 'active' : 'inactive'}.`);
      setInactiveCoach(null);
      setInactiveReason('');
      setReturnToServiceDate('');
      await loadBoard();
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Coach status could not be changed.');
    }
  }

  function beginDeactivate(coach: FleetCoach) {
    setInactiveCoach(coach);
    setInactiveReason(coach.inactiveReason || '');
    setReturnToServiceDate(coach.returnToServiceDate || '');
  }

  async function confirmDeactivate() {
    if (!inactiveCoach) return;
    if (!inactiveReason.trim()) {
      toast.error('Enter why this coach is inactive.');
      return;
    }
    await setCoachActive(inactiveCoach, false, {
      inactiveReason: inactiveReason.trim(),
      returnToServiceDate,
    });
  }

  if (!isLoaded) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!userId) return <div className="p-8 text-center">Administrator sign-in is required.</div>;

  return (
    <div className="bg-muted/30 text-foreground">
      <main className="mx-auto max-w-7xl space-y-5 px-5 py-6">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CalendarDays className="h-5 w-5" /> Published Monsey Trails schedules</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-5">
            <Input type="date" value={date} onChange={event => { setDate(event.target.value); setSchedule(null); }} />
            <select className="h-10 rounded-md border bg-background px-3" value={line} onChange={event => changeLine(Number(event.target.value))}>
              {BUS_LINES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <select className="h-10 rounded-md border bg-background px-3" value={origin} onChange={event => changeOrigin(Number(event.target.value))}>
              {areas.map(area => <option key={area.id} value={area.id}>{area.name}</option>)}
            </select>
            <select className="h-10 rounded-md border bg-background px-3" value={destination} onChange={event => { setDestination(Number(event.target.value)); setSchedule(null); }}>
              {destinationOptions.map(area => <option key={area.id} value={area.id}>{area.name}</option>)}
            </select>
            <Button onClick={() => void loadBoard()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Load schedules
            </Button>
          </CardContent>
        </Card>

        {line === 1 && <NewYorkSchedulePdf />}

        {error && <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-destructive"><ShieldAlert className="h-5 w-5" />{error}</div>}

        <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm ${!refreshedAt || clock - refreshedAt.getTime() > 45_000 ? 'border-amber-400 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100' : 'bg-card'}`}>
          <span>
            <strong>{!refreshedAt ? 'Waiting for live dispatch data.' : clock - refreshedAt.getTime() > 45_000 ? 'Dispatch data is stale.' : 'Dispatch data is live.'}</strong>
            {' '}{refreshedAt ? `Last refreshed ${Math.max(1, Math.round((clock - refreshedAt.getTime()) / 1000))} seconds ago.` : 'Assignments have not loaded yet.'}
          </span>
          <span className="text-xs">Automatically refreshes every 15 seconds. In-progress choices are preserved.</span>
        </div>

        <div id="communications"><DispatchCommunications assignments={activeAssignments} /></div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Bus className="h-5 w-5" /> Coach fleet registry</CardTitle>
            <p className="text-sm text-muted-foreground">Registering a coach only makes it available below. It does not assign that coach to a driver or schedule.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex max-w-md gap-2">
              <Input placeholder="Coach number" value={newCoach} onChange={event => setNewCoach(event.target.value)} />
              <Button onClick={() => void saveCoach()}>Add coach</Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {coaches.map(coach => (
                <div key={coach.busNumber} className="flex items-start justify-between gap-3 rounded-xl border bg-muted/20 p-3">
                  <div>
                    <p className="font-black"><Link className="underline-offset-4 hover:underline" href={`/admin/coaches/${encodeURIComponent(coach.busNumber)}`}>Coach {coach.busNumber}</Link></p>
                    <p className="text-xs text-muted-foreground">{coach.active ? 'Active' : `Inactive — ${coach.inactiveReason || 'Reason not recorded'}`}</p>
                    {!coach.active && (
                      <p className="mt-1 text-xs font-semibold">
                        {coach.returnToServiceDate ? `Expected back ${new Date(`${coach.returnToServiceDate}T12:00:00`).toLocaleDateString()}` : 'Return date not set'}
                      </p>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => coach.active ? beginDeactivate(coach) : void setCoachActive(coach, true)}>
                    Mark {coach.active ? 'inactive' : 'active'}
                  </Button>
                </div>
              ))}
              {coaches.length === 0 && <p className="text-sm text-muted-foreground">No coaches have been added yet.</p>}
            </div>
            {inactiveCoach && (
              <div className="max-w-2xl space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <div>
                  <p className="font-black">Mark coach {inactiveCoach.busNumber} inactive</p>
                  <p className="text-sm text-muted-foreground">The reason appears in inventory and assignment controls. The return date is optional.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_190px]">
                  <Input aria-label="Inactive reason" placeholder="Reason, such as maintenance or seasonal storage" value={inactiveReason} maxLength={240} onChange={event => setInactiveReason(event.target.value)} />
                  <Input aria-label="Expected return-to-service date" type="date" value={returnToServiceDate} onChange={event => setReturnToServiceDate(event.target.value)} />
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => void confirmDeactivate()}>Save inactive status</Button>
                  <Button variant="outline" onClick={() => setInactiveCoach(null)}>Cancel</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          {schedule?.runs.length ? <ScheduleKeyLegend legend={schedule.keyLegend} /> : null}
          {schedule?.runs.map(run => {
            const key = createOfficialRunKey({ date, line, origin, destination, runId: run.id });
            const assignment = activeAssignments.find(item => sameOfficialRunKey(item.officialRunKey, key));
            const assignedDriver = drivers.find(driver => driver.id === assignment?.driverId);
            const pairedScreenCount = activeTrips.find(trip => trip.busNumber === assignment?.busNumber)?.pairedScreenCount ?? 0;
            const selectedDriverId = driverByRun[run.id] || '';
            const selectedBusNumber = (busByRun[run.id] || '').trim().toUpperCase();
            const {
              driver: driverConflict,
              coach: coachConflict,
              conflict: selectionConflict,
            } = assignmentSelectionConflict(selectedDriverId, selectedBusNumber, activeAssignments);
            return (
              <Card key={run.id}>
                <CardContent className="grid gap-4 p-5 lg:grid-cols-[1fr_1.5fr_auto] lg:items-center">
                  <div>
                    <div className="flex items-center gap-2 text-xl font-black"><Route className="h-5 w-5 text-primary" />{timeLabel(run.scheduledTime)}</div>
                    <ScheduleKeyBadges keys={run.displayKeys} legend={schedule.keyLegend} className="mt-1" />
                    <p className="text-sm font-semibold text-muted-foreground">{schedule.origin.name} → {schedule.destination.name}</p>
                    <p className="text-xs text-muted-foreground">Published arrival {run.arrivalTime ? timeLabel(run.arrivalTime) : 'unavailable'}</p>
                    <DisruptionEditor runKey={key} />
                  </div>
                  {assignment ? (
                    <div className="rounded-xl border bg-muted/40 p-3">
                      <p className="font-black"><Link className="underline-offset-4 hover:underline" href={`/admin/coaches/${encodeURIComponent(assignment.busNumber)}`}>Coach {assignment.busNumber}</Link></p>
                      <p className="text-sm text-muted-foreground">{assignedDriver?.displayName || assignedDriver?.username || 'Assigned driver'} · {assignment.status}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-2">
                      <select className="h-10 rounded-md border bg-background px-3" value={driverByRun[run.id] || ''} onChange={event => setDriverByRun(current => ({ ...current, [run.id]: event.target.value }))}>
                        <option value="">Choose driver</option>
                        {activeDrivers.map(driver => <option key={driver.id} value={driver.id}>{driver.displayName || driver.username || driver.id}</option>)}
                      </select>
                      <select
                        aria-label="Choose coach"
                        className="h-10 rounded-md border bg-background px-3"
                        value={busByRun[run.id] || ''}
                        onChange={event => setBusByRun(current => ({ ...current, [run.id]: event.target.value }))}
                      >
                        <option value="">Choose coach</option>
                        {coaches.map(coach => (
                          <option key={coach.busNumber} value={coach.busNumber} disabled={!coach.active}>
                            Coach {coach.busNumber}{coach.active ? '' : ` — unavailable: ${coach.inactiveReason || 'inactive'}${coach.returnToServiceDate ? `; expected back ${coach.returnToServiceDate}` : ''}`}
                          </option>
                        ))}
                      </select>
                      </div>
                      {selectionConflict && (
                        <div className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" role="alert">
                          <p className="font-black">Assignment conflict</p>
                          {driverConflict && <p>The selected driver is already assigned to coach {driverConflict.busNumber}. Open that coach to stop or release the existing assignment first.</p>}
                          {!driverConflict && coachConflict && <p>Coach {coachConflict.busNumber} is already assigned to {coachConflict.driverName || 'another driver'}. Stop or release that assignment first.</p>}
                          <Button asChild variant="outline" size="sm" className="mt-2 bg-background text-foreground">
                            <Link href={`/admin/coaches/${encodeURIComponent((driverConflict || coachConflict)!.busNumber)}`}>Review coach {(driverConflict || coachConflict)!.busNumber}</Link>
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                  {assignment ? (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="outline"
                        disabled={disconnectingBus === assignment.busNumber}
                        onClick={() => void disconnectScreens(assignment.busNumber)}
                        aria-label={`Log out paired screens for coach ${assignment.busNumber}`}
                      >
                        {disconnectingBus === assignment.busNumber
                          ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          : <LogOut className="mr-2 h-4 w-4" />}
                        Log out paired screens ({pairedScreenCount})
                      </Button>
                      {assignment.status === 'running' ? (
                        <Button
                          variant="destructive"
                          disabled={controllingBus === assignment.busNumber}
                          onClick={() => void controlTrip(assignment.busNumber, 'stop')}
                        >
                          {controllingBus === assignment.busNumber
                            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            : <Square className="mr-2 h-4 w-4" />}
                          Stop trip
                        </Button>
                      ) : (
                        <>
                          <Button
                            disabled={controllingBus === assignment.busNumber}
                            onClick={() => void controlTrip(assignment.busNumber, 'start')}
                          >
                            {controllingBus === assignment.busNumber
                              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              : <Play className="mr-2 h-4 w-4" />}
                            Start trip
                          </Button>
                          <Button variant="outline" className="text-destructive" disabled={controllingBus === assignment.busNumber} onClick={() => void unassign(assignment.busNumber)}>
                            <Trash2 className="mr-2 h-4 w-4" /> Unassign
                          </Button>
                        </>
                      )}
                    </div>
                  ) : (
                    <Button disabled={savingRun === run.id || Boolean(selectionConflict)} onClick={() => void assign(run.id)}>
                      {savingRun === run.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Assign driver, coach & schedule
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {schedule && schedule.runs.length === 0 && <Card><CardContent className="p-8 text-center text-muted-foreground">No published runs were found for this direction and date.</CardContent></Card>}
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Assignment history</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-6">
              <Input aria-label="History from date" type="date" value={historyFrom} onChange={event => setHistoryFrom(event.target.value)} />
              <Input aria-label="History to date" type="date" value={historyTo} onChange={event => setHistoryTo(event.target.value)} />
              <select className="h-10 rounded-md border bg-background px-3" value={historyCoach} onChange={event => setHistoryCoach(event.target.value)}>
                <option value="">All coaches</option>
                {coaches.map(coach => <option key={coach.busNumber} value={coach.busNumber}>Coach {coach.busNumber}</option>)}
              </select>
              <select className="h-10 rounded-md border bg-background px-3" value={historyDriver} onChange={event => setHistoryDriver(event.target.value)}>
                <option value="">All drivers</option>
                {drivers.map(driver => <option key={driver.id} value={driver.id}>{driver.displayName || driver.username || driver.id}</option>)}
              </select>
              <Input placeholder="Direction" value={historyDirection} onChange={event => setHistoryDirection(event.target.value)} />
              <select className="h-10 rounded-md border bg-background px-3" value={historyState} onChange={event => setHistoryState(event.target.value)}>
                <option value="all">Active and historical</option><option value="active">Active only</option><option value="historical">Historical only</option>
              </select>
            </div>
            <Button variant="outline" onClick={() => void loadBoard()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Apply filters</Button>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead><tr className="border-b text-xs uppercase text-muted-foreground"><th className="p-2">Date</th><th className="p-2">Coach</th><th className="p-2">Driver</th><th className="p-2">Direction</th><th className="p-2">Departure</th><th className="p-2">Outcome</th></tr></thead>
                <tbody>
                  {visibleHistory.map(item => (
                    <tr key={item.id} className="border-b">
                      <td className="p-2">{item.serviceDate}</td><td className="p-2 font-bold"><Link className="underline-offset-4 hover:underline" href={`/admin/coaches/${encodeURIComponent(item.busNumber)}`}>{item.busNumber}</Link></td>
                      <td className="p-2">{item.driverName || drivers.find(driver => driver.id === item.driverId)?.displayName || item.driverId}</td>
                      <td className="p-2">{item.direction}</td>
                      <td className="p-2">{item.scheduledDepartureAt ? new Date(item.scheduledDepartureAt).toLocaleString() : '—'}</td>
                      <td className="p-2 capitalize">{item.completedAt ? item.status : 'active'}</td>
                    </tr>
                  ))}
                  {visibleHistory.length === 0 && <tr><td className="p-6 text-center text-muted-foreground" colSpan={6}>No assignments match these filters.</td></tr>}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}