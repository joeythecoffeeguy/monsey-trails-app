import { useState } from 'react';
import { recordScheduleObservation, ScheduleSourceHealth, type ScheduleObservation } from './schedule-source-health';
import {
  fetchOfficialSchedule,
  resolveOfficialRun,
  createOfficialRunKey,
  OfficialSchedule,
  OfficialScheduleRun,
  ResolvedOfficialRoute,
  BUS_LINES,
  SERVICE_AREAS
} from '@/providers/official-schedules';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Clock, Route, AlertCircle, Calendar, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ScheduleKeyBadges, ScheduleKeyLegend } from '@/components/schedule-keys';
import { NewYorkSchedulePdf } from '@/components/new-york-schedule-pdf';

export interface OfficialSchedulePlannerProps {
  onApply: (
    destination: { id: string; label: string; note?: string; lat: number; lng: number },
    stops: { id: string; label: string; note?: string; lat: number; lng: number }[],
    officialRunKey: string,
  ) => void;
  disabled?: boolean;
}

function getTodayString() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function formatTime(value: string) {
  if (!value) return '—';
  const normalizedValue = value.replace(/\.(\d{3})\d+(?=Z|[+-]\d{2}:\d{2}$)/, '.$1');
  const dated = normalizedValue.includes('T');
  const clock = /^(\d{2}):([0-5]\d)(?::[0-5]\d)?$/.exec(normalizedValue);
  const date = dated ? new Date(normalizedValue) : clock
    ? new Date(`2000-01-01T${String(Number(clock[1]) % 24).padStart(2, '0')}:${clock[2]}:00Z`)
    : new Date(NaN);
  if (Number.isNaN(date.getTime())) return 'Unavailable';
  const formatted = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: dated ? 'America/New_York' : 'UTC' }).format(date);
  return `${formatted}${clock && Number(clock[1]) >= 24 ? ' (+1 day)' : ''}`;
}

function compactRouteMarkerLabel(mapLabel: string | undefined, index: number) {
  const label = mapLabel?.trim() ?? '';
  return label.length > 0 && label.length <= 3 ? label : String(index + 1);
}

function PublishedArrival({ run }: { run: OfficialScheduleRun }) {
  if (!run.arrivalTime || run.arrivalVerification === 'unavailable') {
    return (
      <div className="max-w-36 text-xs font-bold leading-tight text-amber-700" data-testid={`arrival-warning-${run.id}`}>
        Published arrival unavailable
      </div>
    );
  }

  if (run.arrivalVerification === 'unverified') {
    return (
      <div className="max-w-36 text-xs font-bold leading-tight text-destructive" data-testid={`arrival-warning-${run.id}`}>
        Arrival date mismatch
      </div>
    );
  }

  if (run.arrivalVerification !== 'verified') {
    return (
      <div className="max-w-36 text-xs font-bold leading-tight text-amber-700" data-testid={`arrival-warning-${run.id}`}>
        Published arrival unverified
      </div>
    );
  }

  return <div className="font-black text-lg" data-testid={`arrival-time-${run.id}`}>{formatTime(run.arrivalTime)}</div>;
}

export function OfficialSchedulePlanner({ onApply, disabled }: OfficialSchedulePlannerProps) {
  const [date, setDate] = useState(getTodayString());
  const [lineId, setLineId] = useState('1');
  const [originId, setOriginId] = useState<string>('2');
  const [destinationId, setDestinationId] = useState<string>('5');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [schedule, setSchedule] = useState<OfficialSchedule | null>(null);
  const [sourceObservations, setSourceObservations] = useState<ScheduleObservation[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [resolvedRoute, setResolvedRoute] = useState<ResolvedOfficialRoute | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');

  async function handleLoadRuns() {
    if (!date || !originId || !destinationId) return;
    setLoading(true);
    setError('');
    setSchedule(null);
    setSelectedRunId(null);
    setResolvedRoute(null);
    setResolveError('');
    try {
      const res = await fetchOfficialSchedule(Number(lineId), Number(originId), Number(destinationId), date);
      setSchedule(res);
      setSourceObservations(previous => recordScheduleObservation(previous, Number(lineId), res));
    } catch (err: any) {
      setError(err.message || 'Failed to load official schedule.');
    } finally {
      setLoading(false);
    }
  }

  const selectedRun = schedule?.runs.find(r => r.id === selectedRunId);
  async function resolveRun(runId: string) {
    setResolvedRoute(null);
    setResolveError('');
    setResolving(true);
    try {
      setResolvedRoute(await resolveOfficialRun(Number(lineId), Number(originId), Number(destinationId), date, runId));
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : 'Could not verify the published stop coordinates.');
    } finally {
      setResolving(false);
    }
  }

  async function handleSelectRun(runId: string) {
    if (selectedRunId === runId) {
      setSelectedRunId(null);
      setResolvedRoute(null);
      setResolveError('');
      return;
    }
    setSelectedRunId(runId);
    setResolvedRoute(null);
    setResolveError('');
    setResolving(true);
    try {
      const route = await resolveOfficialRun(Number(lineId), Number(originId), Number(destinationId), date, runId);
      setResolvedRoute(route);
      await onApply(
        route.destination,
        route.stops.map(pt => ({
          id: pt.id,
          label: pt.label,
          note: pt.note,
          lat: pt.lat,
          lng: pt.lng,
        })),
        createOfficialRunKey({
          line: Number(lineId),
          origin: Number(originId),
          destination: Number(destinationId),
          date,
          runId: route.runId,
        }),
      );
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : 'Could not load this published route.');
    } finally {
      setResolving(false);
    }
  }

  function handleApply() {
    if (!resolvedRoute) return;
    onApply(
      resolvedRoute.destination,
      resolvedRoute.stops.map(pt => ({
        id: pt.id,
        label: pt.label,
        note: pt.note,
        lat: pt.lat,
        lng: pt.lng
      })),
      createOfficialRunKey({
        line: Number(lineId),
        origin: Number(originId),
        destination: Number(destinationId),
        date,
        runId: resolvedRoute.runId,
      }),
    );
  }

  const availableAreas = SERVICE_AREAS.filter((area) => area.lines.includes(Number(lineId)));
  const originNumber = Number(originId);
  const destinationIds = Number(lineId) === 1
    ? ([1, 2].includes(originNumber) ? [3, 4, 5, 6, 11, 12] : [1, 2])
    : Number(lineId) === 2
      ? ([1, 2].includes(originNumber) ? [10] : [1, 2])
      : ([7, 8].includes(originNumber) ? [9, 3] : [7, 8]);
  const destinationAreas = availableAreas.filter((area) => destinationIds.includes(area.id));

  function handleOriginChange(value: string) {
    setOriginId(value);
    const origin = Number(value);
    const nextDestinationIds = Number(lineId) === 1
      ? ([1, 2].includes(origin) ? [3, 4, 5, 6, 11, 12] : [1, 2])
      : Number(lineId) === 2
        ? ([1, 2].includes(origin) ? [10] : [1, 2])
        : ([7, 8].includes(origin) ? [9, 3] : [7, 8]);
    if (!nextDestinationIds.includes(Number(destinationId))) setDestinationId(String(nextDestinationIds[0]));
    setSchedule(null);
    setSelectedRunId(null);
    setResolvedRoute(null);
    setResolveError('');
  }

  function handleLineChange(value: string) {
    setLineId(value);
    const line = Number(value);
    const defaults = line === 3 ? ['7', '9'] : line === 2 ? ['2', '10'] : ['2', '5'];
    setOriginId(defaults[0]);
    setDestinationId(defaults[1]);
    setSchedule(null);
    setSelectedRunId(null);
    setResolvedRoute(null);
    setResolveError('');
  }

  return (
    <div className={cn(
      "w-full transition-all duration-300",
      disabled && "opacity-50 pointer-events-none"
    )}>
      <div className="bg-muted/20 p-6 border-b border-border/50">
        <h2 className="text-xl font-black flex items-center gap-2 mb-1">
          <Calendar className="w-5 h-5 text-primary" />
          Official Schedule
        </h2>
        <p className="text-sm font-medium text-muted-foreground">Choose the line and scheduled run assigned to this coach.</p>
      </div>
      <div className="p-6 space-y-5">
        {Number(lineId) === 1 && <NewYorkSchedulePdf />}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-[0.1em] font-black text-muted-foreground">Bus line</label>
            <Select value={lineId} onValueChange={handleLineChange} disabled={loading || resolving}>
              <SelectTrigger data-testid="select-schedule-line" className="h-12 bg-background font-bold rounded-xl border-border/70">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {BUS_LINES.map(line => (
                  <SelectItem key={line.id} value={String(line.id)} className="font-bold">{line.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-[0.1em] font-black text-muted-foreground">Date</label>
            <Input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              disabled={loading}
              data-testid="input-schedule-date"
              className="h-12 bg-background font-bold rounded-xl border-border/70"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-[0.1em] font-black text-muted-foreground">Origin</label>
            <Select value={originId} onValueChange={handleOriginChange} disabled={loading || resolving}>
              <SelectTrigger data-testid="select-schedule-origin" className="h-12 bg-background font-bold rounded-xl border-border/70">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {availableAreas.map(area => (
                  <SelectItem key={area.id} value={String(area.id)} className="font-bold">
                    {area.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] uppercase tracking-[0.1em] font-black text-muted-foreground">Destination</label>
            <Select value={destinationId} onValueChange={setDestinationId} disabled={loading || resolving}>
              <SelectTrigger data-testid="select-schedule-destination" className="h-12 bg-background font-bold rounded-xl border-border/70">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {destinationAreas.map(area => (
                  <SelectItem key={area.id} value={String(area.id)} className="font-bold">
                    {area.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          className="w-full h-12 font-bold rounded-full"
          variant="secondary"
          disabled={loading}
          onClick={handleLoadRuns}
          data-testid="button-load-runs"
        >
          {loading ? 'Loading...' : 'Load Runs'}
        </Button>

        {error && (
          <div className="p-4 bg-destructive/10 text-destructive text-sm font-bold rounded-[16px] flex items-center gap-2 border border-destructive/20" data-testid="error-schedule">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {error}
          </div>
        )}

        <ScheduleSourceHealth observations={sourceObservations} />

        {schedule && schedule.runs.length === 0 && (
          <div className="text-center p-8 bg-muted/10 border border-dashed rounded-[16px]" data-testid="empty-schedule">
            <p className="text-sm font-bold text-muted-foreground">No runs found for this route and date.</p>
          </div>
        )}

        {schedule && schedule.runs.length > 0 && (
          <div className="mt-6 space-y-3">
            <ScheduleKeyLegend legend={schedule.keyLegend} />
            <div className="border border-border/70 rounded-[20px] overflow-hidden bg-card divide-y">
            {schedule.runs.map(run => {
              const isSelected = selectedRunId === run.id;
              return (
                <div key={run.id} className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => void handleSelectRun(run.id)}
                    className={cn(
                      "w-full text-left flex items-center justify-between p-4 transition-colors hover:bg-muted/30 focus:outline-none focus-visible:bg-muted/50",
                      isSelected && "bg-primary/5 hover:bg-primary/5"
                    )}
                    data-testid={`button-run-${run.id}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-full flex flex-col items-center justify-center shrink-0 transition-colors",
                        isSelected ? "bg-primary text-primary-foreground shadow-sm" : "bg-primary/10 text-primary"
                      )}>
                        <span className="text-base font-black leading-none">{run.routeSymbol || '?'}</span>
                      </div>
                      <div>
                        <div className="font-black text-lg">
                          {formatTime(run.scheduledTime)}
                        </div>
                         <ScheduleKeyBadges keys={run.displayKeys} legend={schedule.keyLegend} className="mt-1" />
                        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <span>Begins {formatTime(run.firstPickupTime)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <PublishedArrival run={run} />
                      <div className="text-xs font-semibold text-muted-foreground flex items-center justify-end gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {Math.floor(run.durationMinutes / 60)}h {run.durationMinutes % 60}m
                      </div>
                    </div>
                  </button>

                  {isSelected && (
                    <div className="p-5 border-t bg-muted/5">
                      {resolvedRoute?.points.length ? (
                        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm font-bold">
                          <Route className="h-5 w-5 text-primary" />
                          Published route loaded with {resolvedRoute.points.length} verified stops.
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="space-y-1.5">
                            <div className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">Pickup</div>
                            <div className="text-sm font-bold">{run.pickupDescription}</div>
                          </div>
                          <div className="space-y-1.5">
                            <div className="text-[10px] font-black text-muted-foreground uppercase tracking-wider">Dropoff</div>
                            <div className="text-sm font-bold">{run.dropoffDescription}</div>
                          </div>
                          {resolving && (
                            <div className="text-sm font-bold text-primary border-t pt-4 flex items-center gap-2" data-testid="resolving-route">
                              <Loader2 className="w-4 h-4 animate-spin" /> Verifying every published stop coordinate…
                            </div>
                          )}
                          {resolveError && (
                            <div className="rounded-[12px] bg-destructive/10 p-4 text-sm font-bold text-destructive flex items-start gap-2 border border-destructive/20" data-testid="error-route-resolution">
                              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                              {resolveError}
                            </div>
                          )}
                          {!resolving && resolveError && (
                            <Button
                              variant="secondary"
                              className="w-full h-11 rounded-full font-bold mt-2"
                              onClick={() => void resolveRun(run.id)}
                            >
                              Retry Stop Verification
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
