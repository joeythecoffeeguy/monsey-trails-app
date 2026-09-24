import type { OfficialSchedule } from '@/providers/official-schedules';

export interface ScheduleObservation {
  line: number;
  schedule: OfficialSchedule;
  consecutiveConflictingChecks: number;
  lastConflict: OfficialSchedule | null;
}

export function recordScheduleObservation(
  observations: ScheduleObservation[], line: number, schedule: OfficialSchedule,
): ScheduleObservation[] {
  const matches = (entry: ScheduleObservation) => entry.line === line &&
    entry.schedule.date === schedule.date &&
    entry.schedule.origin.id === schedule.origin.id &&
    entry.schedule.destination.id === schedule.destination.id;
  const previous = observations.find(matches);
  const conflicting = schedule.runs.some(run => run.arrivalVerification === 'unverified');
  const repeatedSnapshot = previous?.schedule.fetchedAt === schedule.fetchedAt;
  const entry: ScheduleObservation = {
    line,
    schedule,
    consecutiveConflictingChecks: conflicting
      ? (previous?.consecutiveConflictingChecks ?? 0) + (repeatedSnapshot ? 0 : 1)
      : 0,
    lastConflict: conflicting ? schedule : previous?.lastConflict ?? null,
  };
  return [...observations.filter(entry => !matches(entry)), entry];
}

export function ScheduleSourceHealth({ observations }: { observations: ScheduleObservation[] }) {
  const affected = observations.filter(entry => entry.lastConflict);
  if (!affected.length) return null;
  const dates = new Map<string, number>();
  for (const { schedule } of affected) {
    const count = schedule.runs.filter(run => run.arrivalVerification === 'unverified').length;
    if (count) dates.set(schedule.date, (dates.get(schedule.date) ?? 0) + count);
  }
  return (
    <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3 text-sm" aria-label="Official schedule source health" data-testid="schedule-source-health">
      <div role="status">
        <h3 className="font-bold">Official schedule arrival-date checks</h3>
        <p>{dates.size
          ? `${[...dates.values()].reduce((a, b) => a + b, 0)} conflicting run listings across ${dates.size} service date(s).`
          : 'No remaining arrival-date conflicts in the latest checked schedules.'}</p>
      </div>
      <p>These are official-source data issues, not traffic-provider failures. Conflicting published arrivals are withheld; independent traffic estimates may still be available. No timestamps or run identities are changed.</p>
      <p className="text-muted-foreground">Scope: schedules loaded in this planner session, not the entire timetable. Counts are run listings per line and boarding route, not unique coaches. Use Load Runs again to recheck the selected date and route; the source cache can take 30 seconds to refresh. Failed loads do not clear previous findings.</p>
      {[...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => (
        <p key={date} className="font-bold">{date}: {count} conflicting run listing(s)</p>
      ))}
      {affected.map(({ line, schedule, consecutiveConflictingChecks, lastConflict }) => {
        const conflicts = schedule.runs.filter(run => run.arrivalVerification === 'unverified');
        const oldIds = lastConflict!.runs.filter(run => run.arrivalVerification === 'unverified').map(run => run.id);
        const verified = oldIds.every(id => schedule.runs.some(run => run.id === id && run.arrivalVerification === 'verified'));
        return (
          <details key={`${line}|${schedule.date}|${schedule.origin.id}|${schedule.destination.id}`} className="border-t border-amber-500/30 pt-2">
            <summary className="cursor-pointer font-semibold">
              {schedule.date} · Line {line} · {schedule.origin.name} → {schedule.destination.name}: {conflicts.length
                ? `${conflicts.length} conflict(s)${consecutiveConflictingChecks > 1 ? ` — repeated across ${consecutiveConflictingChecks} source snapshots` : ''}`
                : verified ? 'Corrected — arrivals now verified' : 'No current conflicts — previous arrivals unavailable or runs removed'}
            </summary>
            <p className="mt-2">Latest source fetch: {schedule.fetchedAt}. Source: {schedule.source}</p>
            <p>Last conflicting source evidence (unchanged values), fetched {lastConflict!.fetchedAt}:</p>
            <ul className="space-y-2 mt-2">
              {lastConflict!.runs.filter(run => run.arrivalVerification === 'unverified').map((run, index) => (
                <li key={`${run.id}-${index}`} className="break-all font-mono text-xs">
                  Run ID: {run.id} · First pickup: {run.firstPickupTime} · Departure: {run.scheduledTime} · Raw arrival: {run.arrivalTime ?? '(missing)'}
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </section>
  );
}