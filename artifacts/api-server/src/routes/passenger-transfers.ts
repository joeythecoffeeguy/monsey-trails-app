import { Router, type IRouter } from "express";
import { SearchPassengerTransfersBody, SearchPassengerTransfersResponse } from "@workspace/api-zod";
import {
  buildPassengerJourney,
  createOfficialScheduleRunKey,
  fetchOfficialSchedule,
  findExactLiveRun,
  resolveEquivalentOfficialRunKeys,
  resolveVerifiedOfficialRun,
  scheduledDepartureInstant,
  type ResolvedOfficialRun,
} from "./schedule";

const router: IRouter = Router();
const DEFAULT_BUFFER_MINUTES = 15;
const SEARCH_HORIZON_MS = 8 * 60 * 60_000;
const MAX_SCHEDULE_LOOKUPS = 10;
const MAX_RESOLVED_CANDIDATES = 12;
const MAX_OPTIONS = 3;

type CandidateRun = {
  query: { line: number; origin: number; destination: number; date: string };
  run: {
    id: string;
    firstPickupTime: string;
    scheduledTime: string;
  };
};

type JourneyForTransfer = Awaited<ReturnType<typeof buildPassengerJourney>>;

const AREA_NAMES: Record<number, string> = {
  1: "New Square",
  2: "Monsey",
  3: "Boro Park",
  4: "Williamsburg",
  5: "Manhattan",
  6: "Wall Street",
  7: "Lakewood (Westgate)",
  8: "Lakewood (Sq. Kennedy)",
  9: "Flatbush",
  10: "Kiryas Yoel",
  11: "B&H",
  12: "Crown Heights",
};

export function parseExactRunKey(runKey: string) {
  const [date, lineText, originText, destinationText, runId, extra] = runKey.split("|");
  const line = Number(lineText);
  const origin = Number(originText);
  const destination = Number(destinationText);
  if (
    extra
    || !runId
    || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")
    || ![1, 2, 3].includes(line)
    || !Number.isInteger(origin)
    || !Number.isInteger(destination)
    || origin === destination
  ) return null;
  return { date, line, origin, destination, runId };
}

function nextServiceDate(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function onwardQueries(origin: number, dates: string[]) {
  const pairs: Array<[number, number[]]> = [];
  if ([1, 2].includes(origin)) {
    pairs.push([1, [3, 4, 5, 6, 11, 12]], [2, [10]]);
  } else {
    if ([3, 4, 5, 6, 11, 12].includes(origin)) pairs.push([1, [1, 2]]);
    if (origin === 10) pairs.push([2, [1, 2]]);
    if ([3, 9].includes(origin)) pairs.push([3, [7, 8]]);
    if ([7, 8].includes(origin)) pairs.push([3, [3, 9]]);
  }
  return dates.flatMap(date => pairs.flatMap(([line, destinations]) =>
    destinations.map(destination => ({ line, origin, destination, date })),
  )).slice(0, MAX_SCHEDULE_LOOKUPS);
}

function comparableStop(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sharedPublishedStop(incoming: ResolvedOfficialRun, onward: ResolvedOfficialRun, areaId: number) {
  const incomingStops = incoming.stops.filter(stop => stop.kind === "dropoff" && stop.areaId === areaId);
  const onwardStops = onward.stops.filter(stop => stop.kind === "pickup" && stop.areaId === areaId);
  for (const arrival of incomingStops) {
    const departure = onwardStops.find(stop => comparableStop(stop.label) === comparableStop(arrival.label));
    if (departure) return { arrival, departure };
  }
  return null;
}

export function assessPublishedTransfer(input: {
  incoming: ResolvedOfficialRun;
  onward: ResolvedOfficialRun;
  incomingJourney: JourneyForTransfer;
  transferAreaId: number;
  minimumBufferMinutes: number;
  now?: number;
}) {
  const shared = sharedPublishedStop(input.incoming, input.onward, input.transferAreaId);
  if (!shared || !shared.arrival.scheduledAt) return null;
  const onwardDepartureAt = shared.departure.scheduledAt ?? input.onward.scheduledDepartureAt;
  if (!onwardDepartureAt) return null;
  const scheduledArrival = new Date(shared.arrival.scheduledAt).getTime();
  const departure = new Date(onwardDepartureAt).getTime();
  if (!Number.isFinite(scheduledArrival) || !Number.isFinite(departure)) return null;
  const publishedBuffer = Math.floor((departure - scheduledArrival) / 60_000);
  if (publishedBuffer < input.minimumBufferMinutes) return null;

  const journeyStop = input.incomingJourney.stops.find(stop => stop.id === shared.arrival.id);
  const liveUpdatedAt = input.incomingJourney.trafficUpdatedAt
    ? new Date(input.incomingJourney.trafficUpdatedAt).getTime()
    : NaN;
  const stopEta = journeyStop?.estimatedArrivalAt;
  const etaIsTrafficDerived = Boolean(stopEta)
    && stopEta !== shared.arrival.scheduledAt;
  const hasLiveArrival = input.incomingJourney.trafficStatus === "live"
    && Number.isFinite(liveUpdatedAt)
    && liveUpdatedAt <= (input.now ?? Date.now())
    && (input.now ?? Date.now()) - liveUpdatedAt <= 90_000
    && etaIsTrafficDerived;
  const arrivalBasisAt = hasLiveArrival ? journeyStop!.estimatedArrivalAt! : shared.arrival.scheduledAt;
  const bufferMinutes = Math.floor((departure - new Date(arrivalBasisAt).getTime()) / 60_000);
  const connectionStatus = bufferMinutes < 0
    ? "at_risk" as const
    : bufferMinutes < input.minimumBufferMinutes
      ? "tight" as const
      : "possible" as const;
  const arrivalBasis = hasLiveArrival ? "live" as const : "scheduled" as const;
  const warning = arrivalBasis === "live"
    ? connectionStatus === "at_risk"
      ? "Live arrival is after this published departure. This connection is at risk and is not guaranteed."
      : connectionStatus === "tight"
        ? "Live arrival leaves less than your requested buffer. This connection is tight and is not guaranteed."
        : "Uses a fresh live arrival estimate and a published departure. The connection is not guaranteed."
    : "Uses published times only; delays may make this transfer impossible. The connection is not guaranteed.";
  return {
    departureAt: onwardDepartureAt,
    arrivalBasisAt,
    arrivalBasis,
    bufferMinutes,
    sharedStop: {
      id: shared.arrival.id,
      label: shared.arrival.label,
      areaId: input.transferAreaId,
    },
    connectionStatus,
    warning,
  };
}

async function loadCandidates(
  transferAreaId: number,
  dates: string[],
  startAt: number,
  endAt: number,
) {
  const settled = await Promise.allSettled(onwardQueries(transferAreaId, dates).map(async query => ({
    query,
    schedule: await fetchOfficialSchedule(query),
  })));
  const candidates: CandidateRun[] = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const run of result.value.schedule.runs as CandidateRun["run"][]) {
      const departure = scheduledDepartureInstant(
        result.value.query.date,
        run.firstPickupTime || run.scheduledTime,
      )?.getTime();
      if (departure && departure >= startAt && departure <= endAt) {
        candidates.push({ query: result.value.query, run });
      }
    }
  }
  return candidates.sort((a, b) => {
    const left = scheduledDepartureInstant(a.query.date, a.run.firstPickupTime || a.run.scheduledTime)!.getTime();
    const right = scheduledDepartureInstant(b.query.date, b.run.firstPickupTime || b.run.scheduledTime)!.getTime();
    return left - right;
  }).slice(0, MAX_RESOLVED_CANDIDATES);
}

router.post("/public-schedules/monsey-trails/transfers", async (req, res): Promise<void> => {
  res.setHeader("cache-control", "no-store");
  const body = SearchPassengerTransfersBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "Choose an exact published run and a buffer from 5 to 120 minutes." });
    return;
  }
  const runKey = body.data.runKey.trim();
  const parsed = parseExactRunKey(runKey);
  const requestedBuffer = body.data.minimumBufferMinutes ?? DEFAULT_BUFFER_MINUTES;
  const minimumBufferMinutes = Number(requestedBuffer);
  if (
    !parsed
    || runKey.length > 180
    || !Number.isInteger(minimumBufferMinutes)
    || minimumBufferMinutes < 5
    || minimumBufferMinutes > 120
  ) {
    res.status(400).json({ error: "Choose an exact published run and a buffer from 5 to 120 minutes." });
    return;
  }

  try {
    const incoming = await resolveVerifiedOfficialRun(parsed, parsed.runId);
    const exactTrip = await findExactLiveRun(await resolveEquivalentOfficialRunKeys(runKey));
    const incomingJourney = await buildPassengerJourney(incoming, exactTrip);
    const scheduledArrival = incoming.scheduledArrivalAt
      ? new Date(incoming.scheduledArrivalAt).getTime()
      : NaN;
    if (!Number.isFinite(scheduledArrival)) {
      res.status(422).json({ error: "This run has no verified published arrival time for transfer search." });
      return;
    }
    const searchedThrough = new Date(scheduledArrival + SEARCH_HORIZON_MS);
    const candidates = await loadCandidates(
      parsed.destination,
      [parsed.date, nextServiceDate(parsed.date)],
      scheduledArrival + minimumBufferMinutes * 60_000,
      searchedThrough.getTime(),
    );
    const options = [];
    for (const candidate of candidates) {
      const onward = await resolveVerifiedOfficialRun(candidate.query, candidate.run.id);
      const assessment = assessPublishedTransfer({
        incoming,
        onward,
        incomingJourney,
        transferAreaId: parsed.destination,
        minimumBufferMinutes,
      });
      if (!assessment) continue;
      options.push({
        runKey: createOfficialScheduleRunKey(candidate.query, candidate.run.id),
        line: candidate.query.line,
        origin: { id: candidate.query.origin, name: AREA_NAMES[candidate.query.origin] },
        destination: { id: candidate.query.destination, name: AREA_NAMES[candidate.query.destination] },
        serviceDate: candidate.query.date,
        ...assessment,
      });
      if (options.length >= MAX_OPTIONS) break;
    }
    res.json(SearchPassengerTransfersResponse.parse({
      incomingRunKey: incoming.runKey,
      minimumBufferMinutes,
      searchedThrough: searchedThrough.toISOString(),
      options,
      message: options.length
        ? "Only exact published runs sharing the named stop are shown. No walking connection is assumed."
        : "No published onward run with the requested buffer and a verified shared stop was found in the next 8 hours.",
    }));
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404 || status === 422) {
      res.status(status).json({ error: (error as Error).message });
      return;
    }
    req.log.warn({ err: error }, "passenger transfer search failed");
    res.status(502).json({ error: "Transfer search is temporarily unavailable." });
  }
});

export default router;