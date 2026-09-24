/**
 * Release preflight: pnpm --filter @workspace/api-server run audit:schedule-stops
 * Checks a full service week so weekday-only descriptions are not missed.
 * No geocoder or database access is used; this command never writes coordinates.
 */
import { fetchOfficialSchedule, unresolvedPublishedRunStops } from "../routes/schedule";

type Area = { id: number; name: string };
type Line = { id: number; name: string; outgoingareas: Area[]; incomingareas: Area[] };
type Direction = { line: number; origin: number; destination: number; label: string };

async function publishedDirections(): Promise<Direction[]> {
  const response = await fetch("https://www.monseytrails.com/", {
    headers: { "User-Agent": "MonseyTrailsCoachDisplay/1.0 schedule audit" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Official homepage returned ${response.status}`);
  const html = await response.text();
  const raw = /\blines:\s*(\[[^\n]+\]),\s*\n/.exec(html)?.[1];
  if (!raw) throw new Error("Official homepage no longer exposes the published directions");
  const lines = JSON.parse(raw) as Line[];
  if (!Array.isArray(lines) || !lines.length) throw new Error("Official homepage has no service lines");
  const directions: Direction[] = [];
  for (const line of lines) {
    if (!Array.isArray(line.outgoingareas) || !Array.isArray(line.incomingareas)
      || !line.outgoingareas.length || !line.incomingareas.length) {
      throw new Error(`Official line ${line.id} has no published service areas`);
    }
    for (const home of line.outgoingareas) for (const away of line.incomingareas) {
      for (const [origin, destination] of [[home, away], [away, home]]) {
        directions.push({
          line: line.id, origin: origin.id, destination: destination.id,
          label: `${line.name}: ${origin.name} → ${destination.name}`,
        });
      }
    }
  }
  return directions;
}

async function main() {
  const dateArg = process.argv[2];
  if (dateArg && (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg)
    || new Date(`${dateArg}T12:00:00Z`).toISOString().slice(0, 10) !== dateArg)) {
    throw new Error("Optional argument must be a valid YYYY-MM-DD service date");
  }
  const start = dateArg ?? new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const directions = await publishedDirections();
  const jobs = directions.flatMap(direction => Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(`${start}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return { direction, date: date.toISOString().slice(0, 10) };
  }));
  const unresolved = new Map<string, Set<string>>();
  const empty = new Map<string, number>();
  let runCount = 0;
  let cursor = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < jobs.length) {
      const { direction, date } = jobs[cursor++];
      const query = { line: direction.line, origin: direction.origin,
        destination: direction.destination, date };
      const schedule = await fetchOfficialSchedule(query);
      if (schedule.origin.id !== query.origin || schedule.destination.id !== query.destination) {
        throw new Error(`Official response does not match ${direction.label} on ${date}`);
      }
      if (!schedule.runs.length) empty.set(direction.label, (empty.get(direction.label) ?? 0) + 1);
      for (const run of schedule.runs) {
        runCount++;
        if (!run.id || (!run.pickupDescription && !run.dropoffDescription)) {
          const key = `${direction.label} | ${date} | run ${run.id || "(missing ID)"}`;
          unresolved.set(key, new Set(["(missing pickup and drop-off descriptions)"]));
          continue;
        }
        for (const stop of unresolvedPublishedRunStops(run, query)) {
          const key = `${direction.label} | ${date} | run ${run.id} | ${stop.kind} area ${stop.areaId}`;
          const labels = unresolved.get(key) ?? new Set<string>();
          labels.add(stop.label);
          unresolved.set(key, labels);
        }
      }
    }
  }));
  process.stdout.write(`Checked ${directions.length} directions, ${jobs.length} direction-days, ${runCount} runs (${start} + 6 days).\n`);
  for (const [direction, days] of empty) {
    process.stdout.write(`No published runs: ${direction} (${days}/7 days)\n`);
  }
  if (unresolved.size) {
    for (const [context, labels] of unresolved) {
      for (const label of labels) process.stderr.write(`UNRESOLVED ${context}: ${JSON.stringify(label)}\n`);
    }
    throw new Error(`${unresolved.size} run descriptions contain unresolved verified stop labels`);
  }
  process.stdout.write("Every available run stop description matches verified aliases; no provider coordinates used.\n");
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});