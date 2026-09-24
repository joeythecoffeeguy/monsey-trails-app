import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accumulateJourneyEtas,
  auditedRegionalStopLines,
  auditedBoroParkStopLines,
  buildPassengerJourney,
  clearOfficialScheduleCachesForTest,
  clearJourneyTrafficCachesForTest,
  createOfficialScheduleRunKey,
  fetchJourneyTraffic,
  fetchOfficialSchedule,
  isFreshLiveJourneyTrip,
  normalizeSchedule,
  orderedSharedOriginStopLines,
  passengerStopSummary,
  passengerStopNotes,
  parseStopDescription,
  publicDepartureStatus,
  publishedStopInstant,
  publishedArrivalInstant,
  publishedArrivalVerification,
  resolveOfficialAssignment,
  resolveVerifiedOfficialRun,
  remainingOfficialJourneyStops,
  reconcilePersistedJourneyStopIds,
  scheduledDepartureInstant,
  isVerifiedSharedOriginRun,
  isVerifiedManhattanBoroParkThroughRun,
  knownStop,
  INTEGRATED_SCHEDULE_STOPS,
  integratedScheduleStops,
  scheduleStopKey,
  applyStopOverride,
  displayedScheduleKeys,
  orderedManhattanBoroParkDropoffs,
  publishedStopCategory,
  verifiedSharedOriginRunKeys,
  validScheduleQuery,
  unresolvedPublishedRunStops,
} from "./schedule";
import { clearTomTomRoutingCooldownForTest } from "../lib/tomtom-routing";

test("integrated registry covers omitted audited regions and every entry resolves", () => {
  for (const [areaId, sourceLabel] of INTEGRATED_SCHEDULE_STOPS) {
    assert.ok(knownStop(sourceLabel, areaId), `${areaId}:${sourceLabel}`);
  }
  const resolved = integratedScheduleStops();
  assert.equal(
    new Set(resolved.map(stop => scheduleStopKey(stop.areaId, stop.canonicalLabel))).size,
    resolved.length,
    "admin registry exposes one editable record per canonical stop",
  );
  assert.ok(resolved.some(stop => stop.areaId === 6 && stop.sourceLabel === "Trinity Place & Exchange"));
  assert.ok(resolved.some(stop => stop.areaId === 5 && stop.sourceLabel === "7th Avenue & 42nd Street"));
  assert.ok(resolved.some(stop => stop.areaId === 10 && stop.sourceLabel === "Bais Hachaim"));
  assert.ok(resolved.some(stop => stop.areaId === 7 && stop.sourceLabel === "River Ave in front of Evergreen"));
});

test("Tishrei catalog roles are published defaults without changing out-of-scope stops", () => {
  const stops = integratedScheduleStops();
  const category = (areaId: number, label: string) =>
    stops.find(stop => stop.areaId === areaId && stop.canonicalLabel === label)?.category;

  assert.equal(category(3, "18th Avenue & 50th Street"), "both");
  assert.equal(category(3, "18th Avenue & 49th Street"), "pickup");
  assert.equal(category(1, "New Square"), "both");
  assert.equal(category(4, "Bedford Avenue & Hewes Street"), "both");
  assert.equal(category(4, "Bedford Avenue & Wilson Street"), "both");
  assert.equal(category(5, "5th Avenue & 47th Street"), "pickup");
  assert.equal(category(5, "5th Avenue & 45th Street"), "dropoff");
  assert.equal(category(5, "5th Avenue & 42nd Street"), "both");
  assert.equal(category(11, "B&H — 34th Street & 9th Avenue"), "both");
  assert.equal(category(2, "Robert Pitt Drive & Route 59"), "dropoff");
  assert.equal(category(7, "Westgate Shopping Center"), "both");
  assert.equal(publishedStopCategory(10, "Bais Medrash bus shelter"), "both");
});

test("current New Square destination wording resolves to the audited stop", () => {
  const expected = {
      lat: 41.1381882,
      lng: -74.0306377,
      passengerLabel: "Jackson Avenue & Washington Avenue",
  };
  for (const label of [
    "Along Washington Avenue & Jackson Avenue",
    "Along Washington Avenue, Right on Jackson Avenue, left on Washington Avenue to end of Route.",
  ]) {
    assert.deepEqual(knownStop(label, 1), {
      ...expected,
      label,
    });
  }
});

test("published Manhattan return stops resolve to verified positions without live geocoding", () => {
  for (const [areaId, source, lat, lng] of [
    [5, "On 5th Ave corner 47th Street (576 5th Ave).", 40.756592, -73.978751],
    [5, "On 42nd corner 5th (front of Zara).", 40.753348, -73.981034],
    [5, "On 42nd corner 7th (new victory theater).", 40.756311, -73.987403],
    [5, "On 42nd corner 8th (across port authority)", 40.757191, -73.989904],
    [2, "Maple Ave corner Phillies Terrace.", 41.116078, -74.07049],
  ] as const) {
    const point = knownStop(source, areaId);
    assert.ok(point, `Unverified published stop: ${source}`);
    assert.deepEqual({ lat: point.lat, lng: point.lng }, { lat, lng });
  }
});

test("published wording audit resolves only evidenced curbside stops without a provider", () => {
  const cases = [
    [11, "Drops off on 9Th Ave and 34Th street", "B&H — 34th Street & 9th Avenue", 40.753106, -73.995857],
    [2, "On Old Nyack Tpk. Corner S Madison (Chaya Sarah hall).", "Old Nyack Turnpike & South Madison Avenue", 41.101364, -74.047608],
    [2, "Route 59 corner Robert Pitt.", "Robert Pitt Drive & Route 59", 41.107788, -74.064541],
    [7, "Cross Street corner Granite drive (satmar)", "Cross Street & Granite Drive", 40.055448, -74.222459],
  ] as const;
  for (const [areaId, label, passengerLabel, lat, lng] of cases) {
    assert.deepEqual(knownStop(label, areaId), { label, passengerLabel, lat, lng }, label);
    assert.deepEqual(unresolvedPublishedRunStops(
      { pickupDescription: label, dropoffDescription: "" },
      { line: 1, origin: areaId, destination: 2 },
    ), [], label);
  }
  const unknown = "On 42nd corner 6th (new stop)";
  const query = { line: 1, origin: 5, destination: 2 };
  const run = { pickupDescription: `Stop 1: On 5th Ave corner 47th Street (576 5th Ave).\nStop 2: ${unknown}`,
    dropoffDescription: "Route 59 corner Robert Pitt." };
  assert.deepEqual(unresolvedPublishedRunStops(run, query), [
    { areaId: 5, kind: "pickup", label: unknown },
  ]);
  assert.deepEqual(unresolvedPublishedRunStops(run, query, new Set([scheduleStopKey(5, unknown)])), []);
  assert.deepEqual(unresolvedPublishedRunStops(run, query, new Set([scheduleStopKey(2, unknown)])), [
    { areaId: 5, kind: "pickup", label: unknown },
  ], "an approved override must belong to the exact area and source label");
  assert.equal(knownStop(unknown, 5), null, "nearby geocoder guesses cannot count as verified");
});

test("unknown published wording returns 422 without geocoder fallback", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TOMTOM_API_KEY;
  const query = { date: "2026-09-23", line: 3, origin: 7, destination: 9 };
  clearOfficialScheduleCachesForTest();
  delete process.env.TOMTOM_API_KEY;
  let description = "Cross Street corner Granite drive (satmar)";
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/")) return new Response('<meta name="csrf-token" content="test">');
    if (String(input).endsWith("/ajax/schedule")) return Response.json({
      origin: "Lakewood", origin_id: 7, destination: "Flatbush", destination_id: 9,
      schedule: [{
        schedule_busroute_id: 123, first_time: "08:00:00", time: "08:00:00",
        busroute: { route_code: "L3", description, description2: "On Coney Island and Ave. N, and on Conery Island corner Ave. J" },
      }],
    });
    throw new Error(`Provider must not be called: ${input}`);
  };
  try {
    const resolved = await resolveVerifiedOfficialRun(query, "123", []);
    assert.equal(resolved.stops[0].label, "Cross Street & Granite Drive");
    description = "Cross Street corner unverified new stop";
    clearOfficialScheduleCachesForTest();
    await assert.rejects(resolveVerifiedOfficialRun(query, "123", []), (error: unknown) => {
      const failure = error as { status: number; unresolved: string[] };
      assert.equal(failure.status, 422);
      assert.deepEqual(failure.unresolved, [description]);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TOMTOM_API_KEY;
    else process.env.TOMTOM_API_KEY = originalKey;
    clearOfficialScheduleCachesForTest();
  }
});

test("coordinate overrides never replace canonical passenger labels", () => {
  const stop = { label: "Bais Medrash bus shelter", lat: 1, lng: 2, passengerLabel: "Bais Medrash bus shelter" };
  const updated = applyStopOverride(stop, { lat: 3, lng: 4, address: "123 Private Search Address" });
  assert.equal(updated.label, stop.label);
  assert.equal(updated.passengerLabel, stop.passengerLabel);
  assert.deepEqual({ lat: updated.lat, lng: updated.lng }, { lat: 3, lng: 4 });
});

test("validates supported public schedule queries", () => {
  assert.deepEqual(
    validScheduleQuery({ line: "1", origin: "2", destination: "5", date: "2026-09-16" }),
    { line: 1, origin: 2, destination: 5, date: "2026-09-16" },
  );
  assert.equal(validScheduleQuery({ line: "9", origin: "2", destination: "2", date: "bad" }), null);
});

test("parses published pickup and dropoff descriptions in source order", () => {
  assert.deepEqual(
    parseStopDescription(`Stop 1: Viola & Union.
2. Route 306 & Viola.
stop 3: Maple Avenue.`),
    ["Viola & Union.", "Route 306 & Viola.", "Maple Avenue."],
  );
});

test("passenger schedule summaries contain stops instead of driving and timing instructions", () => {
  assert.equal(
    passengerStopSummary(
      "Beginning of Route, Right on Jackson Avenue, left on Washington Avenue goes along Washington Avenue, leaves New Square.",
      1,
    ),
    "Jackson Avenue & Washington Avenue",
  );
  assert.equal(
    passengerStopSummary("Stop 1: Starts on Viola Road & Union Road 15 minutes prior to schedule time.", 2),
    "Viola Road & Union Road",
  );
  assert.equal(
    passengerStopSummary("Route 306 across Ohr Sameach.", 2),
    "Route 306 & Viola Road",
  );
  assert.equal(
    passengerStopSummary("Stops on Route 59 & corner West Street.", 2),
    "Route 59 & West Street",
  );
  assert.equal(
    passengerStopSummary("Drops off in Manhattan at 34th St & and 9th Ave.", 5),
    "B&H — 34th Street & 9th Avenue",
  );
  assert.equal(
    passengerStopSummary("Along 50th St", 3, 1),
    "18th Avenue & 50th Street • 17th Avenue & 49th Street • 16th Avenue & 49th Street • 15th Avenue & 49th Street • 14th Avenue & 49th Street • 13th Avenue & 49th Street • 12th Avenue & 49th Street • 11th Avenue & 49th Street • Fort Hamilton Parkway & 49th Street",
  );
  assert.equal(
    passengerStopNotes("18th Ave & 50th", 3),
    "Starts at 18th Avenue & 50th Street, then serves every bus stop along 49th Street through Fort Hamilton Parkway",
  );
  assert.equal(
    passengerStopSummary("18th Avenue between 50th Street", 3, 1),
    "18th Avenue & 50th Street • 17th Avenue & 49th Street • 16th Avenue & 49th Street • 15th Avenue & 49th Street • 14th Avenue & 49th Street • 13th Avenue & 49th Street • 12th Avenue & 49th Street • 11th Avenue & 49th Street • Fort Hamilton Parkway & 49th Street",
  );
  assert.equal(
    passengerStopSummary("Along 50th St", 3, 3),
    "18th Avenue & 49th Street • 17th Avenue & 49th Street • 16th Avenue & 49th Street • 15th Avenue & 49th Street • 14th Avenue & 49th Street • 13th Avenue & 49th Street • 12th Avenue & 49th Street • 11th Avenue & 49th Street • Fort Hamilton Parkway & 49th Street",
  );
  assert.deepEqual(
    auditedBoroParkStopLines("Starts at 18th Avenue between 50th/49th, then along 49th through Fort Hamilton Pkwy", 1),
    [
      "18th Avenue & 50th Street",
      "17th Avenue & 49th Street",
      "16th Avenue & 49th Street",
      "15th Avenue & 49th Street",
      "14th Avenue & 49th Street",
      "13th Avenue & 49th Street",
      "12th Avenue & 49th Street",
      "11th Avenue & 49th Street",
      "Fort Hamilton Parkway & 49th Street",
    ],
  );
  assert.deepEqual(
    auditedBoroParkStopLines("49th by 18th, then every bus stop through Fort Hamilton Parkway", 3)?.slice(0, 2),
    ["18th Avenue & 49th Street", "17th Avenue & 49th Street"],
  );
  assert.equal(
    auditedBoroParkStopLines("18th Avenue & 49th Street", 3),
    null,
    "one explicit stop must not be mistaken for the whole corridor",
  );
});

test("preserves official rider details as separate notes without route narration", () => {
  assert.equal(passengerStopNotes("Route 306 across Ohr Sameach.", 2), "across Ohr Sameach");
  assert.equal(passengerStopNotes(
    "On Maple Ave in front of the nursing home.\nOn Monsey Blvd at the bus shelter.",
    2,
  ), "in front of the nursing home");
  assert.equal(passengerStopNotes(
    "Starts on Viola Road & Union Road 5 minutes before scheduled time.", 2,
  ), "5 minutes before scheduled time");
  assert.equal(passengerStopNotes(
    "Right on Jackson Avenue, then turns right and goes along Washington Avenue.", 1,
  ), undefined);
});

test("reconciles audited NY, Lakewood, and KJ narrative variants", () => {
  const cases = [
    ["On 306 across Ohr Sameach (corner Viola Road).", 2, "Route 306 & Viola Road", "across Ohr Sameach"],
    ["At scheduled time - On Maple Avenue in front of the nursing home.", 2, "Maple Avenue", "in front of the nursing home • At scheduled time"],
    ["Robert Pitt Road corner Route 59 side of Monsey Hub.", 2, "Robert Pitt Drive & Route 59", "side of Monsey Hub"],
    ["Route 59 across Evergreen Supermarket.", 2, "Route 59 at Amazing Savings", "across Evergreen Supermarket"],
    ["Bates (Monsey Glatt).", 2, "Bates", "Monsey Glatt"],
    ["Westgate Shopping Center in front of Kosher West sign.", 7, "Westgate Shopping Center", "in front of Kosher West sign"],
    ["River Ave in front of Kimball Hospital.", 7, "Monmouth Medical Center — 600 River Avenue", "in front of Kimball Hospital"],
    ["At schedule time - Bais Medrash.", 10, "Bais Medrash bus shelter", "At schedule time"],
    ["Bais Hachaim 10 minutes before schedule.", 10, "Bais Hachaim — 82 Raywood Drive", "10 minutes before schedule"],
  ] as const;
  for (const [raw, area, label, note] of cases) {
    assert.equal(passengerStopSummary(raw, area), label, raw);
    assert.equal(passengerStopNotes(raw, area), note, raw);
  }
});

test("audits every published Williamsburg, Flatbush, Lakewood, and KJ route variant", () => {
  const compound = [
    ["On Bedford Avenue between Hewes and Hooper (613 Bedford Ave) and continues to Bedford Avenue between Wilson and Taylor.", 4,
      ["Bedford Avenue & Hewes Street", "Bedford Avenue & Wilson Street"]],
    ["Starts 10 minutes before schedule on Bedford Avenue corner Wallabout street, at schedule time on Bedford between Hewes and Hooper and continues to Bedford Ave. between Wilson and Taylor.", 4,
      ["Bedford Avenue & Wallabout Street", "Bedford Avenue & Hewes Street", "Bedford Avenue & Wilson Street"]],
    ["On Coney Island and Ave. N, and on Conery Island corner Ave. J", 9,
      ["Coney Island Avenue & Avenue N", "Coney Island Avenue & Avenue J"]],
    ["At Coney Island and Ave. J, & at Coney Island corner Ave. N", 9,
      ["Coney Island Avenue & Avenue J", "Coney Island Avenue & Avenue N"]],
    ["Picks up at Squankum and Kennedy, ON Kennedy across Astor.", 8,
      ["Kennedy Boulevard & Squankum Road"]],
    ["Drops off on 5th Ave corner 47st, 45st, 42st, 23st.", 5,
      ["5th Avenue & 47th Street", "5th Avenue & 45th Street", "5th Avenue & 42nd Street", "5th Avenue & 23rd Street"]],
    ["Drops off on Bakertown Rd. front of Park and Ride, left on Israel Zupnik, left on acres left on forest, right on schunnemunk Rd, right on quickway left on van buren, right on Garfield.", 10,
      ["Kiryas Joel Park & Ride", "Garfield Road bus stop"]],
  ] as const;
  for (const [raw, area, expected] of compound) {
    assert.deepEqual(auditedRegionalStopLines(raw, area), expected, raw);
    for (const stop of expected) assert.ok(knownStop(stop, area), stop);
  }

  const individual = [
    [7, "Westgate Shopping center in front of Kosher west sign"],
    [7, "Miller Rd corner New central Ave"],
    [7, "14th at corner Case"],
    [7, "On Forest Ave corner 9th Street"],
    [7, "On Kennedy corner Squankum"],
    [7, "Cross Street corner Granite drive (satmer)"],
    [7, "On River Ave in front of Evergreen"],
    [7, "Madison Ave corner 9th street"],
    [7, "Clifton Ave corner 10th Street"],
    [7, "On River Ave in front of Kimball Hospital"],
    [10, "At schedule time - at the Bais Medrash"],
    [10, "10 minutes before schedule - at the Bais Hachaim"],
    [10, "Forest corner Gorlitz"],
    [10, "Acers corner Krolla"],
    [10, "Acers corner Israel Zupnik"],
    [10, "On Bakertown corner I Zupnik corner"],
    [10, "Schunnemunk corner Seven Springs"],
    [10, "Quickway corner Van Buren"],
    [10, "Park and Ride"],
  ] as const;
  for (const [area, raw] of individual) assert.ok(knownStop(raw, area), raw);
  assert.equal(knownStop("Bedford Avenue somewhere", 4), null);
  assert.deepEqual(
    auditedRegionalStopLines(
      "On Bedford Avenue between Hewes and Hooper and then at an unverified new stop.",
      4,
    ),
    ["On Bedford Avenue between Hewes and Hooper and then at an unverified new stop."],
  );
  assert.equal(
    knownStop("Park and Ride and then an unverified new stop", 10),
    null,
  );
  assert.deepEqual(
    auditedRegionalStopLines(
      "Drops off on Bakertown Rd. front of Park and Ride, then at an unverified new stop, right on Garfield.",
      10,
    ),
    ["Drops off on Bakertown Rd. front of Park and Ride, then at an unverified new stop, right on Garfield."],
  );
  assert.equal(knownStop("Lakewood landmark to be confirmed", 7), null);
  assert.equal(knownStop("Unknown KJ corridor", 10), null);
});

test("landmark stops remain truthful across outgoing, return, and through-route summaries", () => {
  for (const area of [1, 2]) {
    for (const route of ["1", "1P", "3", "3P"]) {
      const raw = [
        "Picks up ON SCHEDULE time On Maple Ave in front of the nursing home.",
        "On Monsey Blvd at the bus shelter.",
        "On Monsey Blvd across West Central.",
        ...(route.endsWith("P") ? ["New Park and Ride."] : []),
        "In front of Amazing Savings at the bus shelter.",
      ].map((line, index) => `Stop ${index + 1}: ${line}`).join("\n");
      const expected = [
        "Maple Avenue",
        "Monsey Boulevard — bus shelter",
        "Monsey Boulevard & West Central Avenue",
        ...(route.endsWith("P") ? ["Monsey Park & Ride"] : []),
        "Amazing Savings",
      ].join(" • ");
      assert.equal(passengerStopSummary(raw, area), expected, `Route ${route}, area ${area}`);
      assert.equal(passengerStopSummary(raw.replace("Picks up", "Drops off"), area), expected);
    }
    assert.equal(passengerStopSummary("Monsey Blvd corner Maple Ave.", area),
      "Monsey Boulevard & Maple Avenue");
    assert.equal(passengerStopSummary("Monsey Boulevard", area), "Monsey Boulevard");
    assert.equal(passengerStopSummary("On Maple Avenue in front of the nursing home.", area),
      "Maple Avenue");
    for (const alias of ["Kosher Castle", "Kosher Kastle", "Evergreen Supermarket"]) {
      assert.equal(passengerStopSummary(alias, area), "Amazing Savings");
    }
  }
  // Monsey's landmark aliases must not leak into another service area's stops.
  assert.equal(passengerStopSummary("Park and Ride.", 10), "Kiryas Joel Park & Ride");
  assert.equal(passengerStopSummary("Amazing Savings", 3), "Amazing Savings");
});

test("returns only the fields used by the coach display", () => {
  const result = normalizeSchedule({
    origin: "Monsey",
    origin_id: 2,
    destination: "Manhattan",
    destination_id: 5,
    schedule: [{
      schedule_busroute_id: 123,
      first_time: "05:50:00",
      time: "06:15:00",
      arrival: "2026-09-16T11:45:00.000000Z",
      duration: 115,
      busroute: {
        route_code: "N1PBGH",
        route_symbol: "1P",
        route_symbol2: "G",
        direction: "outgoing",
        description: "Pickup instructions",
        description2: "Dropoff instructions",
      },
    }],
  }, "2026-09-16");
  assert.deepEqual(result.runs[0], {
    id: "123",
    routeCode: "N1PBGH",
    routeSymbol: "1P",
    secondarySymbol: "G",
    direction: "outgoing",
    firstPickupTime: "05:50:00",
    scheduledTime: "06:15:00",
    arrivalTime: "2026-09-16T11:45:00.000000Z",
    arrivalVerification: "verified",
    durationMinutes: 115,
    pickupDescription: "Pickup instructions",
    dropoffDescription: "Dropoff instructions",
    displayKeys: ["B", "G", "H", "P"],
    departureStatus: "awaiting_departure",
    delayMinutes: null,
  });
  assert.equal("schedule" in result, false);
  assert.equal(result.keyLegend.find(item => item.key === "H")?.meaning, "Goes to Williamsburg.");
});

test("schedule display keys use endpoints and reliable run evidence without changing route identity", () => {
  const run = (overrides: Partial<Parameters<typeof displayedScheduleKeys>[0]> = {}) => ({
    routeCode: "N1",
    routeSymbol: "1",
    secondarySymbol: "",
    pickupDescription: "",
    dropoffDescription: "",
    ...overrides,
  });

  assert.deepEqual(displayedScheduleKeys(run(), 2, 4), ["H"], "Williamsburg destination");
  assert.deepEqual(displayedScheduleKeys(run(), 4, 2), ["H"], "Williamsburg origin");
  assert.deepEqual(
    displayedScheduleKeys(run({ routeCode: "N1PQRTX", secondarySymbol: "X" }), 2, 3),
    ["B", "P", "Q", "R", "X"],
    "combined upstream keys remain visible with the inferred Boro Park key",
  );
  assert.deepEqual(
    displayedScheduleKeys(run({
      pickupDescription: "New Park and Ride ONLY IF marked P.",
      dropoffDescription: "Picks up and drops off at B&H Photo",
    }), 2, 5),
    [],
    "conditional Park & Ride wording and B&H text do not create special keys",
  );
  assert.deepEqual(
    displayedScheduleKeys(run({
      pickupDescription: "If the schedule is marked with a Q the bus will drop off at Bedford and Wallabout Street, Bedford by Hewes Street and continue to Bedford Ave. between Wilson and Taylor.",
    }), 4, 2),
    ["H"],
    "the audited conditional Williamsburg Q description does not add Q to an unmarked run",
  );
  assert.deepEqual(
    displayedScheduleKeys(run({
      routeCode: "N1H",
      pickupDescription: "On Bedford Avenue between Hewes and Hooper and continues to Bedford Avenue between Wilson and Taylor.",
    }), 2, 5),
    ["H"],
    "verified combined upstream Williamsburg evidence retains H on a through-run",
  );
  assert.deepEqual(
    displayedScheduleKeys(run({ dropoffDescription: "Drops off in Manhattan at 5th Avenue & 47th Street" }), 2, 5),
    [],
    "a Manhattan endpoint and a generic 5th Avenue stop do not imply G, M, or R",
  );
  assert.deepEqual(
    displayedScheduleKeys(run({ routeCode: "B2", dropoffDescription: "BH photo pickup" }), 2, 10),
    [],
    "route-code prefixes and unpunctuated BH wording are not rider keys",
  );
});

test("duplicate upstream run IDs get deterministic departure identities", () => {
  const schedule = normalizeSchedule({
    origin_id: 3,
    destination_id: 2,
    schedule: [
      { schedule_busroute_id: 225, first_time: "21:30:00", time: "21:30:00", arrival: "23:00:00", busroute: { id: 225 } },
      { schedule_busroute_id: 225, first_time: "23:00:00", time: "23:00:00", arrival: "01:00:00", busroute: { id: 225 } },
    ],
  }, "2026-09-22");
  assert.deepEqual(schedule.runs.map((run: { id: string }) => run.id), ["225~21:30:00", "225~23:00:00"]);
  const keys = schedule.runs.map((run: { id: string }) => createOfficialScheduleRunKey(
    { line: 1, origin: 3, destination: 2, date: "2026-09-22" },
    run.id,
  ));
  assert.equal(new Set(keys).size, 2);
  assert.ok(keys[0].endsWith("|225~21:30:00"));
  assert.ok(keys[1].endsWith("|225~23:00:00"));
});

test("published arrivals respect New York service dates without correcting upstream evidence", () => {
  const cases = [
    ["08:00:00", "2026-09-23T13:45:00.000000Z", "verified"],
    ["23:30:00", "2026-09-24T05:00:00Z", "verified"],
    ["20:00:00", "2026-09-24T01:00:00Z", "verified"], // still Sep 23 locally
    ["08:00:00", "2026-09-20T13:45:00Z", "unverified"],
    ["08:00:00", "2026-09-25T13:45:00Z", "unverified"],
    ["08:00:00", "2026-09-24T13:45:00Z", "unverified"], // not an overnight rollover
    ["08:00:00", "2026-09-23T11:00:00Z", "unverified"], // before departure
    ["08:00:00", "not-a-date", "unverified"],
    ["08:00:00", "2026-09-23T09:45:00", "unverified"], // ambiguous timezone
    ["08:00:00", null, "unavailable"],
    ["23:30:00", "01:00:00", "verified"],
    ["23:30:00", "25:00:00", "verified"],
  ] as const;
  for (const [time, raw, status] of cases) {
    const date = "2026-09-23";
    const departure = scheduledDepartureInstant(date, time);
    assert.equal(publishedArrivalVerification(date, raw, departure), status, `${time} / ${raw}`);
    const result = normalizeSchedule({ schedule: [{
      schedule_busroute_id: 62884, first_time: time, time, arrival: raw,
      busroute: { id: 191, route_code: "N1PBGH" },
    }] }, date);
    assert.equal(result.date, date);
    assert.equal(result.runs[0].id, "62884");
    assert.equal(result.runs[0].upstreamRouteId, "191");
    assert.equal(result.runs[0].arrivalTime, raw ?? "");
    assert.equal(result.runs[0].arrivalVerification, status);
    assert.equal(result.runs[0].scheduledTime, time);
    assert.equal(Boolean(publishedArrivalInstant(date, raw ?? "", departure)), status === "verified");
    assert.equal(Boolean(publishedStopInstant(date, "Destination", 1, 2, result.runs[0])), status === "verified");
  }
  assert.equal(
    publishedArrivalInstant("2026-09-23", "2026-09-24T05:00:00Z", scheduledDepartureInstant("2026-09-23", "23:30:00"))?.toISOString(),
    "2026-09-24T05:00:00.000Z",
  );
});

test("public departure status uses fresh traffic arrival and never the stored OSRM ETA", () => {
  const now = Date.parse("2026-07-01T12:30:00.000Z");
  const run = normalizeSchedule({
    origin: "Monsey", origin_id: 2, destination: "Manhattan", destination_id: 5,
    schedule: [{
      schedule_busroute_id: "run-1", first_time: "08:00:00", time: "08:00:00",
      arrival: "09:00:00", duration: 60,
      busroute: { route_code: "N1", route_symbol: "1", route_symbol2: "", direction: "out", description: "", description2: "" },
    }],
  }, "2026-07-01").runs[0];
  const base = {
    officialRunKey: "2026-07-01|1|2|5|run-1",
    status: "running",
    retiredAt: null,
    completedAt: null,
    startedAt: new Date(now - 10 * 60_000),
    scheduledDepartureAt: new Date("2026-07-01T12:00:00.000Z"),
    locationUpdatedAt: new Date(now - 30_000),
    eta: new Date("2026-07-01T12:45:00.000Z"),
    ownerSubject: "driver-a",
    currentLat: 41.1,
    currentLng: -74.1,
    intermediateStops: [],
    destinationLat: 40.7,
    destinationLng: -74,
  };
  assert.deepEqual(publicDepartureStatus(run, "2026-07-01", null, now), {
    departureStatus: "awaiting_departure", delayMinutes: null,
  });
  assert.equal(publicDepartureStatus(run, "2026-07-01", { ...base, status: "ready", startedAt: null }, now).departureStatus, "awaiting_departure");
  assert.deepEqual(publicDepartureStatus(run, "2026-07-01", base, now, new Date("2026-07-01T13:05:00.000Z")), {
    departureStatus: "delayed", delayMinutes: 5,
  }, "TomTom traffic arrival wins even when the stored OSRM ETA predicts an early arrival");
  assert.equal(publicDepartureStatus(run, "2026-07-01", base, now, new Date("2026-07-01T13:01:00.000Z")).departureStatus, "on_time");
  assert.equal(publicDepartureStatus(run, "2026-07-01", { ...base, locationUpdatedAt: new Date(now - 91_000) }, now).departureStatus, "unavailable");
  assert.equal(publicDepartureStatus({ ...run, arrivalTime: "" }, "2026-07-01", base, now, new Date("2026-07-01T13:05:00.000Z")).departureStatus, "live_estimate");
  assert.equal(publicDepartureStatus(run, "2026-07-01", { ...base, completedAt: new Date(now) }, now).departureStatus, "completed");
  assert.equal(
    publicDepartureStatus(run, "2026-07-01", { ...base, eta: new Date("2026-07-01T12:45:00.000Z") } as typeof base, now).departureStatus,
    "unavailable",
    "a routing-provider failure cannot fall back to the driver's old stored OSRM ETA",
  );
});

test("published run status identity includes exact service date, line, direction, and run", () => {
  assert.equal(
    createOfficialScheduleRunKey({ date: "2026-07-01", line: 1, origin: 2, destination: 5 }, "123"),
    "2026-07-01|1|2|5|123",
  );
  assert.notEqual(
    createOfficialScheduleRunKey({ date: "2026-07-02", line: 1, origin: 2, destination: 5 }, "123"),
    "2026-07-01|1|2|5|123",
  );
});

test("verified shared-origin fixture aliases one physical run but not Monsey-only or unrelated runs", () => {
  const fixture = (origin: number, id: number, routeId: number, time: string) =>
    normalizeSchedule({
      origin: origin === 1 ? "New Square" : "Monsey",
      origin_id: origin,
      destination: "Manhattan",
      destination_id: 5,
      schedule: [{
        schedule_busroute_id: id,
        first_time: "07:50:00",
        time,
        arrival: "2026-09-20T13:45:00.000000Z",
        duration: 115,
        busroute: {
          id: routeId,
          route_code: "N1PBGH",
          direction: "outgoing",
          description: origin === 1 ? "Leaves New Square" : "Picks up ON SCHEDULE time on Maple Ave",
          description2: "Drops off at 34th St.",
        },
      }],
    }, "2026-09-20").runs[0];
  const newSquare = fixture(1, 62884, 191, "07:50:00");
  const monsey = fixture(2, 62884, 191, "08:15:00");
  const monseyOnly = fixture(2, 62251, 240, "08:30:00");
  assert.equal(isVerifiedSharedOriginRun(newSquare, monsey), true);
  assert.deepEqual(
    verifiedSharedOriginRunKeys(
      { date: "2026-09-20", line: 1, origin: 2, destination: 5 },
      monsey,
      newSquare,
    ),
    [
      "2026-09-20|1|1|5|62884",
      "2026-09-20|1|2|5|62884",
    ],
  );
  assert.equal(isVerifiedSharedOriginRun(newSquare, monseyOnly), false, "Monsey-only run stays independent");
  assert.deepEqual(
    verifiedSharedOriginRunKeys(
      { date: "2026-09-20", line: 1, origin: 2, destination: 5 },
      monseyOnly,
      newSquare,
    ),
    ["2026-09-20|1|2|5|62251"],
  );
  assert.notDeepEqual(
    verifiedSharedOriginRunKeys(
      { date: "2026-09-21", line: 1, origin: 2, destination: 5 },
      monsey,
      newSquare,
    ),
    verifiedSharedOriginRunKeys(
      { date: "2026-09-20", line: 1, origin: 2, destination: 5 },
      monsey,
      newSquare,
    ),
    "service date remains part of canonical identity",
  );
  assert.notDeepEqual(
    verifiedSharedOriginRunKeys(
      { date: "2026-09-20", line: 1, origin: 2, destination: 3 },
      monsey,
      newSquare,
    ),
    verifiedSharedOriginRunKeys(
      { date: "2026-09-20", line: 1, origin: 2, destination: 5 },
      monsey,
      newSquare,
    ),
    "destination remains part of canonical identity",
  );
  assert.deepEqual(
    verifiedSharedOriginRunKeys(
      { date: "2026-09-20", line: 2, origin: 2, destination: 5 },
      monsey,
      newSquare,
    ),
    ["2026-09-20|2|2|5|62884"],
    "other lines are never origin-aliased",
  );
  assert.equal(newSquare.scheduledTime, "07:50:00");
  assert.equal(monsey.scheduledTime, "08:15:00", "each public offer retains its local published time");
});

test("shared physical route orders New Square before all Monsey pickups and destination", () => {
  const stops = orderedSharedOriginStopLines(
    "Beginning of Route, leaves New Square.",
    "Stop 1: Starts on Viola & Union 15 minutes prior to schedule time.\nStop 2: Picks up ON SCHEDULE time on Maple Ave.",
    "Drops off at 34th St.",
  );
  assert.deepEqual(stops.map(({ areaId, kind }) => ({ areaId, kind })), [
    { areaId: 1, kind: "pickup" },
    { areaId: 2, kind: "pickup" },
    { areaId: 2, kind: "pickup" },
    { areaId: 0, kind: "dropoff" },
  ]);
  assert.equal(
    publishedStopInstant("2026-09-20", stops[1].line, 1, stops.length, {
      firstPickupTime: "07:50:00",
      scheduledTime: "08:15:00",
      arrivalTime: "09:45:00",
    })?.toISOString(),
    "2026-09-20T12:00:00.000Z",
    "the first Monsey pickup uses its 15-minutes-prior wording, not the physical New Square first_time",
  );
});

test("verified Manhattan runs include B&H before a same-run Boro Park continuation", () => {
  const common = {
    id: "62210",
    routeCode: "N1PBGH",
    direction: "outgoing",
    scheduledTime: "06:15:00",
    arrivalTime: "2026-09-22T11:45:00.000Z",
  };
  assert.equal(isVerifiedManhattanBoroParkThroughRun(common, common), true);
  assert.equal(
    isVerifiedManhattanBoroParkThroughRun(common, { ...common, id: "different" }),
    false,
  );
  assert.deepEqual(
    orderedManhattanBoroParkDropoffs(
      "34th Street & 9th Avenue",
      "18th Avenue & 50th Street",
    ),
    [
      { line: "34th Street & 9th Avenue", areaId: 5, kind: "dropoff" },
      { line: "18th Avenue & 50th Street", areaId: 3, kind: "dropoff" },
      { line: "17th Avenue & 49th Street", areaId: 3, kind: "dropoff" },
      { line: "16th Avenue & 49th Street", areaId: 3, kind: "dropoff" },
      { line: "15th Avenue & 49th Street", areaId: 3, kind: "dropoff" },
      { line: "14th Avenue & 49th Street", areaId: 3, kind: "dropoff" },
      { line: "13th Avenue & 49th Street", areaId: 3, kind: "dropoff" },
      { line: "12th Avenue & 49th Street", areaId: 3, kind: "dropoff" },
      { line: "11th Avenue & 49th Street", areaId: 3, kind: "dropoff" },
      { line: "Fort Hamilton Parkway & 49th Street", areaId: 3, kind: "dropoff" },
    ],
  );
});

test("official schedule fetches are single-flight per query and retry after failure cleanup", async () => {
  const originalFetch = globalThis.fetch;
  const query = { date: "2026-09-20", line: 1, origin: 1, destination: 5 };
  clearOfficialScheduleCachesForTest();
  let calls = 0;
  let fail = true;
  globalThis.fetch = async (input) => {
    calls += 1;
    if (fail) {
      await new Promise(resolve => setTimeout(resolve, 5));
      return new Response("", { status: 503 });
    }
    if (String(input).endsWith("/")) {
      return new Response('<meta name="csrf-token" content="test-token">', {
        status: 200,
        headers: { "set-cookie": "session=test; Path=/" },
      });
    }
    return new Response(JSON.stringify({
      origin: "New Square",
      origin_id: 1,
      destination: "Manhattan",
      destination_id: 5,
      schedule: [],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const failed = await Promise.allSettled([
      fetchOfficialSchedule(query),
      fetchOfficialSchedule(query),
      fetchOfficialSchedule(query),
    ]);
    assert.equal(failed.every(result => result.status === "rejected"), true);
    assert.equal(calls, 1, "concurrent failures share one homepage request");
    fail = false;
    await Promise.all([fetchOfficialSchedule(query), fetchOfficialSchedule(query)]);
    assert.equal(calls, 3, "the failed in-flight entry is cleaned up and one retry performs home plus schedule");
    await fetchOfficialSchedule(query);
    assert.equal(calls, 3, "successful result is cached");
  } finally {
    globalThis.fetch = originalFetch;
    clearOfficialScheduleCachesForTest();
  }
});

test("authoritative schedule changes invalidate cached run details for time changes and removals", async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const originalKey = process.env.TOMTOM_API_KEY;
  const query = { date: "2026-09-20", line: 2, origin: 2, destination: 3 };
  let now = originalNow();
  let version: "initial" | "changed" | "removed" = "initial";
  let homepageCalls = 0;
  let scheduleCalls = 0;
  let trafficCalls = 0;
  const scheduleBody = () => ({
    origin: "Monsey",
    origin_id: 2,
    destination: "Boro Park",
    destination_id: 3,
    schedule: version === "removed" ? [] : [{
      schedule_busroute_id: 700,
      first_time: version === "initial" ? "08:00:00" : "08:20:00",
      time: version === "initial" ? "08:00:00" : "08:20:00",
      arrival: version === "initial" ? "09:00:00" : "09:20:00",
      duration: 60,
      busroute: {
        id: 70,
        route_code: "B2",
        route_symbol: "2",
        route_symbol2: "",
        direction: "outgoing",
        description: "Maple Avenue in front of the nursing home",
        description2: "Along 50th St",
      },
    }],
  });
  clearOfficialScheduleCachesForTest();
  Date.now = () => now;
  process.env.TOMTOM_API_KEY = "test-key";
  globalThis.fetch = async (input) => {
    if (String(input).startsWith("https://api.tomtom.com/")) {
      trafficCalls += 1;
      return new Response(JSON.stringify({
        routes: [{
          summary: {
            lengthInMeters: 8_000,
            travelTimeInSeconds: 300,
            noTrafficTravelTimeInSeconds: 260,
          },
          legs: [{
            summary: { travelTimeInSeconds: 300 },
            points: [
              { latitude: 41.1, longitude: -74.1 },
              { latitude: 40.7, longitude: -74 },
            ],
          }],
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(input).endsWith("/")) {
      homepageCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return new Response('<meta name="csrf-token" content="test-token">', {
        status: 200,
        headers: { "set-cookie": "session=test; Path=/" },
      });
    }
    if (String(input).endsWith("/ajax/schedule")) {
      scheduleCalls += 1;
      return new Response(JSON.stringify(scheduleBody()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected request: ${input}`);
  };
  try {
    await Promise.all([
      fetchOfficialSchedule(query),
      fetchOfficialSchedule(query),
      fetchOfficialSchedule(query),
    ]);
    assert.equal(homepageCalls, 1);
    assert.equal(scheduleCalls, 1, "concurrent readers share one authoritative request");

    const runKey = "2026-09-20|2|2|3|700";
    const initial = await resolveOfficialAssignment(runKey);
    assert.equal(initial.scheduledDepartureAt.toISOString(), "2026-09-20T12:00:00.000Z");
    assert.equal(initial.destination.address, "Fort Hamilton Parkway & 49th Street");
    assert.deepEqual(
      initial.intermediateStops.filter(stop => stop.address.includes("49th Street")).map(stop => stop.address),
      [
        "17th Avenue & 49th Street",
        "16th Avenue & 49th Street",
        "15th Avenue & 49th Street",
        "14th Avenue & 49th Street",
        "13th Avenue & 49th Street",
        "12th Avenue & 49th Street",
        "11th Avenue & 49th Street",
      ],
      "the route assignment uses every audited Boro Park stop, not the source shorthand",
    );
    const trafficPoints = [{ lat: 41.1, lng: -74.1 }, { lat: 40.7, lng: -74 }];
    await fetchJourneyTraffic("derived-run-700", trafficPoints);
    await fetchJourneyTraffic("derived-run-700", trafficPoints);
    assert.equal(trafficCalls, 1, "derived journey traffic begins cached");

    now += 30_001;
    version = "changed";
    await fetchOfficialSchedule(query);
    await fetchJourneyTraffic("derived-run-700", trafficPoints);
    assert.equal(trafficCalls, 2, "an authoritative change invalidates derived journey traffic");
    const changed = await resolveOfficialAssignment(runKey);
    assert.equal(
      changed.scheduledDepartureAt.toISOString(),
      "2026-09-20T12:20:00.000Z",
      "changed local times are not masked by the longer verified-run cache",
    );

    now += 30_001;
    version = "removed";
    await fetchOfficialSchedule(query);
    await assert.rejects(
      resolveOfficialAssignment(runKey),
      /no longer in the published schedule/,
      "a deleted run cannot be served from the derived verified-run cache",
    );
    assert.equal(homepageCalls, 3);
    assert.equal(scheduleCalls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    if (originalKey === undefined) delete process.env.TOMTOM_API_KEY;
    else process.env.TOMTOM_API_KEY = originalKey;
    clearOfficialScheduleCachesForTest();
  }
});

test("uses each provider leg duration for cumulative passenger stop estimates", () => {
  assert.deepEqual(
    [...accumulateJourneyEtas(
      Date.parse("2026-09-16T10:00:00.000Z"),
      ["first", "second", "third"],
      [60, 540],
      true,
    )],
    [
      ["first", "2026-09-16T10:00:00.000Z"],
      ["second", "2026-09-16T10:01:00.000Z"],
      ["third", "2026-09-16T10:10:00.000Z"],
    ],
  );
  assert.throws(() => accumulateJourneyEtas(Date.now(), ["a", "b"], [], false));
});

test("published departures use New York DST and reject nonexistent wall times", () => {
  assert.equal(scheduledDepartureInstant("2026-03-08", "02:30:00"), null);
  assert.equal(
    scheduledDepartureInstant("2026-11-01", "01:30:00")?.toISOString(),
    "2026-11-01T06:30:00.000Z",
  );
});

test("observed Saturday run 120 treats 24:15 as Sunday while retaining its service date", () => {
  assert.equal(
    scheduledDepartureInstant("2026-09-19", "24:15:00")?.toISOString(),
    "2026-09-20T04:15:00.000Z",
  );
  assert.equal(
    publishedStopInstant("2026-09-19", "Picks up ON SCHEDULE time on Maple Ave", 3, 10, {
      firstPickupTime: "23:50:00",
      scheduledTime: "24:15:00",
      arrivalTime: "2026-09-20T05:40:00.000000Z",
    })?.toISOString(),
    "2026-09-20T04:15:00.000Z",
  );
});

test("published stop baselines honor structured first pickup and source schedule wording", () => {
  const run = {
    firstPickupTime: "07:50:00",
    scheduledTime: "08:15:00",
    arrivalTime: "09:30:00",
  };
  assert.equal(
    publishedStopInstant("2026-09-20", "Picks up 15 minutes prior to ON SCHEDULE time", 0, 4, run)?.toISOString(),
    "2026-09-20T11:50:00.000Z",
    "structured first pickup is stronger than relative description text",
  );
  assert.equal(
    publishedStopInstant("2026-09-20", "Picks up ON SCHEDULE time at Maple Avenue", 1, 4, run)?.toISOString(),
    "2026-09-20T12:15:00.000Z",
  );
  assert.equal(
    publishedStopInstant("2026-09-20", "At scheduled time - Bais Medrash", 1, 4, run)?.toISOString(),
    "2026-09-20T12:15:00.000Z",
  );
  assert.equal(
    publishedStopInstant("2026-09-20", "Picks up 15 minutes prior to schedule time", 2, 4, run)?.toISOString(),
    "2026-09-20T12:00:00.000Z",
  );
});

test("forecast holding at a published pickup shifts later routed legs without holding at arrivals", () => {
  const start = Date.parse("2026-09-20T11:50:00.000Z");
  const holds = new Map([["maple", Date.parse("2026-09-20T12:15:00.000Z")]]);
  assert.deepEqual(
    [...accumulateJourneyEtas(start, ["first", "maple", "arrival"], [7 * 60, 2 * 60], true, holds)],
    [
      ["first", "2026-09-20T11:50:00.000Z"],
      ["maple", "2026-09-20T12:15:00.000Z"],
      ["arrival", "2026-09-20T12:17:00.000Z"],
    ],
  );
});

test("only a dedicated fresh GPS observation enables live journey routing", () => {
  const now = Date.parse("2026-07-01T12:00:00Z");
  const live = {
    status: "running",
    retiredAt: null,
    ownerSubject: "driver-a",
    officialRunKey: "2026-07-01|1|2|5|123",
    scheduledDepartureAt: new Date(now - 60_000),
    completedAt: null,
    currentLat: 41.1,
    currentLng: -74.1,
    locationUpdatedAt: new Date(now - 30_000),
    updatedAt: new Date(now - 30_000),
    intermediateStops: [],
  };
  assert.equal(isFreshLiveJourneyTrip(live, now), true);
  assert.equal(isFreshLiveJourneyTrip({ ...live, locationUpdatedAt: null }, now), false);
  assert.equal(isFreshLiveJourneyTrip({ ...live, locationUpdatedAt: new Date(now - 90_001) }, now), false);
  assert.equal(isFreshLiveJourneyTrip({
    ...live,
    locationUpdatedAt: new Date(now - 90_001),
    updatedAt: new Date(now),
  }, now), false, "an unrelated settings write must not revive stale GPS");
  assert.equal(isFreshLiveJourneyTrip({
    ...live,
    scheduledDepartureAt: new Date(now + 1),
  }, now), false, "passenger routing remains private before the published departure");
  assert.equal(isFreshLiveJourneyTrip({
    ...live,
    status: "ready",
    scheduledDepartureAt: new Date(now + 1),
  }, now), false, "an assigned trip remains private until it is explicitly started");
});

test("remaining live waypoints use persisted official stop IDs in source order", () => {
  const stops = [
    { id: "official-123-1" },
    { id: "official-123-2" },
    { id: "official-123-3" },
    { id: "official-123-4" },
  ];
  assert.deepEqual(
    remainingOfficialJourneyStops(stops, ["official-123-3", "official-123-2"]),
    [stops[1], stops[2], stops[3]],
  );
  assert.deepEqual(remainingOfficialJourneyStops(stops, []), [stops[3]]);
});

test("TomTom journey traffic is single-flight, cached, and fails closed on partial legs", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TOMTOM_API_KEY;
  const originalNow = Date.now;
  const clockStart = originalNow();
  clearJourneyTrafficCachesForTest();
  clearTomTomRoutingCooldownForTest();
  process.env.TOMTOM_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return new Response(JSON.stringify({
      routes: [{
        summary: {
          travelTimeInSeconds: 600,
          noTrafficTravelTimeInSeconds: 500,
        },
        legs: [
          { summary: { travelTimeInSeconds: 60 }, points: [{ latitude: 1, longitude: 2 }, { latitude: 3, longitude: 4 }] },
          { summary: { travelTimeInSeconds: 540 }, points: [{ latitude: 3, longitude: 4 }, { latitude: 5, longitude: 6 }] },
        ],
      }],
    }), { status: 200 });
  };
  try {
    const points = [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, { lat: 5, lng: 6 }];
    const [first, concurrent] = await Promise.all([
      fetchJourneyTraffic("single-flight", points),
      fetchJourneyTraffic("single-flight", points),
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(first?.legDurationSeconds, [60, 540]);
    assert.deepEqual(concurrent?.legDurationSeconds, [60, 540]);
    await fetchJourneyTraffic("single-flight", points);
    assert.equal(calls, 1, "fresh traffic cache avoids fanout");

    Date.now = () => clockStart + 31_000;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({
        routes: [{
          summary: {
            travelTimeInSeconds: 720,
            noTrafficTravelTimeInSeconds: 600,
          },
          legs: [
            { summary: { travelTimeInSeconds: 120 }, points: [{ latitude: 1, longitude: 2 }, { latitude: 3, longitude: 4 }] },
            { summary: { travelTimeInSeconds: 600 }, points: [{ latitude: 3, longitude: 4 }, { latitude: 5, longitude: 6 }] },
          ],
        }],
      }), { status: 200 });
    };
    const refreshed = await fetchJourneyTraffic("single-flight", points);
    assert.equal(calls, 2);
    assert.deepEqual(refreshed?.legDurationSeconds, [120, 600], "traffic refreshes after the 30-second TTL");

    Date.now = () => clockStart + 62_000;
    globalThis.fetch = async () => new Response("", { status: 503 });
    const stale = await fetchJourneyTraffic("single-flight", points);
    assert.equal(stale?.stale, true);
    assert.deepEqual(stale?.legDurationSeconds, [120, 600]);

    globalThis.fetch = async () => new Response(JSON.stringify({
      routes: [{ legs: [{ summary: { travelTimeInSeconds: 60 }, points: [] }] }],
    }), { status: 200 });
    assert.equal(await fetchJourneyTraffic("partial-route", points), null);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    if (originalKey === undefined) delete process.env.TOMTOM_API_KEY;
    else process.env.TOMTOM_API_KEY = originalKey;
    clearJourneyTrafficCachesForTest();
    clearTomTomRoutingCooldownForTest();
  }
});

test("TomTom denial is bounded and scheduled stop ETAs remain available", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.TOMTOM_API_KEY;
  clearJourneyTrafficCachesForTest();
  clearTomTomRoutingCooldownForTest();
  process.env.TOMTOM_API_KEY = "test-key";
  let routingCalls = 0;
  let roadCalls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("api.tomtom.com/routing/")) {
      routingCalls += 1;
      return new Response(JSON.stringify({
        detailedError: { code: "InsufficientFunds" },
      }), { status: 403 });
    }
    if (url.startsWith("https://router.project-osrm.org/")) {
      roadCalls += 1;
      return new Response("", { status: 503 });
    }
    return new Response("", { status: 404 });
  };
  const now = Date.parse("2026-09-23T12:00:00Z");
  const official = {
    runKey: "provider-denial-run",
    routeCode: "N1",
    originName: "Monsey",
    destinationName: "Manhattan",
    serviceDate: "2026-09-23",
    scheduledDepartureAt: "2026-09-23T11:55:00.000Z",
    scheduledArrivalAt: "2026-09-23T13:15:00.000Z",
    trafficDepartureAt: null,
    stops: [
      { id: "next", label: "Next", mapLabel: "A", lat: 41.1, lng: -74, kind: "pickup" as const, scheduledAt: "2026-09-23T12:10:00.000Z" },
      { id: "final", label: "Final", mapLabel: "B", lat: 40.75, lng: -73.99, kind: "dropoff" as const, scheduledAt: null },
    ],
  };
  const trip = {
    status: "running", retiredAt: null, ownerSubject: "driver", officialRunKey: official.runKey,
    scheduledDepartureAt: new Date("2026-09-23T11:55:00.000Z"), completedAt: null,
    currentLat: 41.12, currentLng: -74.02, locationUpdatedAt: new Date(now - 5_000),
    updatedAt: new Date(now), intermediateStops: official.stops,
  } as any;

  try {
    const first = await buildPassengerJourney(official, trip, now);
    const second = await buildPassengerJourney({ ...official, runKey: "provider-denial-run-2" }, {
      ...trip,
      officialRunKey: "provider-denial-run-2",
    }, now);
    assert.equal(routingCalls, 1, "a denied routing product is not called again during cooldown");
    assert.equal(roadCalls, 2, "each journey makes one bounded road-route fallback attempt");
    assert.equal(first.trafficStatus, "unavailable");
    assert.equal(first.stops[0].estimatedArrivalAt, official.stops[0].scheduledAt);
    assert.equal(first.stops[1].estimatedArrivalAt, official.scheduledArrivalAt);
    assert.equal(second.stops[0].estimatedArrivalAt, official.stops[0].scheduledAt);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.TOMTOM_API_KEY;
    else process.env.TOMTOM_API_KEY = originalKey;
    clearJourneyTrafficCachesForTest();
    clearTomTomRoutingCooldownForTest();
  }
});

test("journey response core keeps private GPS out and routes only persisted remaining IDs", async () => {
  const now = Date.parse("2026-07-01T12:00:00Z");
  const official = {
    runKey: "2026-07-01|1|2|5|123",
    routeCode: "N1",
    originName: "Monsey",
    destinationName: "Manhattan",
    serviceDate: "2026-07-01",
    scheduledDepartureAt: new Date(now - 60_000).toISOString(),
    scheduledArrivalAt: null,
    trafficDepartureAt: new Date(now - 120_000).toISOString(),
    stops: [1, 2, 3, 4].map(index => ({
      id: `official-123-${index}`,
      label: `Stop ${index}`,
      mapLabel: String.fromCharCode(64 + index),
      lat: 40 + index / 10,
      lng: -74,
      kind: index < 3 ? "pickup" as const : "dropoff" as const,
      scheduledAt: null,
    })),
  };
  const trip = {
    status: "running",
    retiredAt: null,
    ownerSubject: "driver-a",
    officialRunKey: official.runKey,
    scheduledDepartureAt: new Date(now - 60_000),
    completedAt: null,
    currentLat: 41,
    currentLng: -73,
    locationUpdatedAt: new Date(now - 10_000),
    updatedAt: new Date(now),
    intermediateStops: [{ id: "official-123-3", address: "Stop 3", lat: 40.3, lng: -74 }],
  } as unknown as NonNullable<Parameters<typeof buildPassengerJourney>[1]>;
  let routedPoints: Array<{ lat: number; lng: number }> = [];
  const traffic = async (_key: string, points: Array<{ lat: number; lng: number }>) => {
    routedPoints = points;
    return {
      routeGeometry: points,
      legDurationSeconds: [60, 300],
      updatedAt: new Date(now).toISOString(),
      stale: false,
    };
  };
  const result = await buildPassengerJourney(official, trip, now, traffic);
  assert.equal(result.trafficStatus, "live");
  assert.deepEqual(routedPoints.map(({ lat, lng }) => ({ lat, lng })), [
    { lat: 41, lng: -73 },
    { lat: 40.3, lng: -74 },
    { lat: 40.4, lng: -74 },
  ]);
  assert.equal(result.stops[0].estimatedArrivalAt, null);
  assert.equal(result.stops[2].estimatedArrivalAt, "2026-07-01T12:01:00.000Z");
  assert.equal(result.stops[3].estimatedArrivalAt, "2026-07-01T12:06:00.000Z");

  routedPoints = [];
  const privateResult = await buildPassengerJourney(official, {
    ...trip,
    status: "ready",
    scheduledDepartureAt: new Date(now + 60_000),
  }, now, traffic);
  assert.equal(privateResult.trafficStatus, "unavailable");
  assert.deepEqual(privateResult.routeGeometry, []);
  assert.equal(routedPoints.length, 0, "GPS from an assigned but unstarted trip must never reach the routing provider");
});

test("legacy Monsey stop IDs reconcile by verified coordinates and remain alert-compatible", async () => {
  const now = Date.parse("2026-09-20T13:00:00Z");
  const official = {
    runKey: "2026-09-20|1|2|5|62884",
    routeCode: "N1PBGH",
    originName: "Monsey",
    destinationName: "Manhattan",
    serviceDate: "2026-09-20",
    scheduledDepartureAt: "2026-09-20T12:15:00.000Z",
    scheduledArrivalAt: null,
    trafficDepartureAt: "2026-09-20T11:50:00.000Z",
    stops: [
      { id: "official-2026-09-20-1-1-5-62884-1", label: "New Square", mapLabel: "A", lat: 41.14, lng: -74.035, kind: "pickup" as const, scheduledAt: "2026-09-20T11:50:00.000Z" },
      { id: "official-2026-09-20-1-1-5-62884-2", label: "Viola & Union", mapLabel: "B", lat: 41.132, lng: -74.054, kind: "pickup" as const, scheduledAt: "2026-09-20T12:00:00.000Z" },
      { id: "official-2026-09-20-1-1-5-62884-3", label: "306 & Wiener", mapLabel: "C", lat: 41.1263, lng: -74.0677, kind: "pickup" as const, scheduledAt: null },
      { id: "official-2026-09-20-1-1-5-62884-4", label: "Maple Ave", mapLabel: "D", lat: 41.11586, lng: -74.06795, kind: "pickup" as const, scheduledAt: "2026-09-20T12:15:00.000Z" },
      { id: "official-2026-09-20-1-1-5-62884-5", label: "34th St", mapLabel: "E", lat: 40.7526, lng: -73.9944, kind: "dropoff" as const, scheduledAt: null },
    ],
  };
  const legacyStops = [
    { id: "official-62884-3", address: "306 & Wiener", lat: 41.1263, lng: -74.0677 },
    { id: "official-62884-4", address: "Maple Ave", lat: 41.11586, lng: -74.06795 },
  ];
  assert.deepEqual(
    reconcilePersistedJourneyStopIds(official.stops, legacyStops).slice(2, 4).map(stop => stop.id),
    legacyStops.map(stop => stop.id),
  );
  const trip = {
    status: "running",
    retiredAt: null,
    ownerSubject: "driver-a",
    officialRunKey: "2026-09-20|1|2|5|62884",
    scheduledDepartureAt: new Date("2026-09-20T11:50:00.000Z"),
    completedAt: null,
    currentLat: 41.13,
    currentLng: -74.06,
    locationUpdatedAt: new Date(now - 5_000),
    updatedAt: new Date(now),
    intermediateStops: legacyStops,
  } as unknown as NonNullable<Parameters<typeof buildPassengerJourney>[1]>;
  let routedIds: string[] = [];
  const result = await buildPassengerJourney(official, trip, now, async (_key, points) => {
    routedIds = points.slice(1).map(point => (
      "id" in point ? String(point.id) : "current"
    ));
    return {
      routeGeometry: points,
      legDurationSeconds: [60, 120, 600],
      updatedAt: new Date(now).toISOString(),
      stale: false,
    };
  });
  assert.deepEqual(routedIds, ["official-62884-3", "official-62884-4", official.stops[4].id]);
  assert.deepEqual(result.stops.slice(2, 4).map(stop => stop.id), legacyStops.map(stop => stop.id));
  assert.equal(result.stops[2].estimatedArrivalAt, "2026-09-20T13:01:00.000Z");
  assert.equal(result.stops[3].estimatedArrivalAt, "2026-09-20T13:03:00.000Z");
});

test("legacy New Square rows without persisted Monsey stops route conservatively to destination", async () => {
  const now = Date.parse("2026-09-20T13:00:00Z");
  const official = {
    runKey: "2026-09-20|1|1|5|62884",
    routeCode: "N1PBGH",
    originName: "New Square",
    destinationName: "Manhattan",
    serviceDate: "2026-09-20",
    scheduledDepartureAt: "2026-09-20T11:50:00.000Z",
    scheduledArrivalAt: null,
    trafficDepartureAt: "2026-09-20T11:50:00.000Z",
    stops: [
      { id: "new-square", label: "New Square", mapLabel: "A", lat: 41.14, lng: -74.035, kind: "pickup" as const, scheduledAt: null },
      { id: "monsey", label: "Maple Ave", mapLabel: "B", lat: 41.115, lng: -74.067, kind: "pickup" as const, scheduledAt: null },
      { id: "destination", label: "34th St", mapLabel: "C", lat: 40.7526, lng: -73.9944, kind: "dropoff" as const, scheduledAt: null },
    ],
  };
  const trip = {
    status: "running", retiredAt: null, ownerSubject: "driver-a", officialRunKey: official.runKey,
    scheduledDepartureAt: new Date("2026-09-20T11:50:00.000Z"), completedAt: null,
    currentLat: 41.13, currentLng: -74.06, locationUpdatedAt: new Date(now - 5_000),
    updatedAt: new Date(now), intermediateStops: [],
  } as unknown as NonNullable<Parameters<typeof buildPassengerJourney>[1]>;
  let routedPointCount = 0;
  const result = await buildPassengerJourney(official, trip, now, async (_key, points) => {
    routedPointCount = points.length;
    return {
      routeGeometry: points,
      legDurationSeconds: [600],
      updatedAt: new Date(now).toISOString(),
      stale: false,
    };
  });
  assert.equal(routedPointCount, 2, "current location routes only to destination");
  assert.equal(result.stops[1].estimatedArrivalAt, null, "an absent legacy Monsey waypoint is not invented as remaining");
});

test("running journey with no intermediate stops routes one live leg to its final destination", async () => {
  const now = Date.parse("2026-09-20T13:00:00Z");
  const official = {
    runKey: "zero-stop-run",
    originName: "Origin",
    destinationName: "Final destination",
    serviceDate: "2026-09-20",
    scheduledDepartureAt: null,
    scheduledArrivalAt: null,
    trafficDepartureAt: null,
    stops: [],
  } as any;
  const trip = {
    status: "running", retiredAt: null, ownerSubject: "driver", officialRunKey: official.runKey,
    scheduledDepartureAt: new Date(now - 60_000), completedAt: null,
    currentLat: 41, currentLng: -73, locationUpdatedAt: new Date(now - 5_000),
    updatedAt: new Date(now), intermediateStops: [],
    destinationLat: 40.7, destinationLng: -74, destinationAddress: "Final destination",
  } as any;
  let points: Array<{ lat: number; lng: number }> = [];
  const result = await buildPassengerJourney(official, trip, now, async (_key, routed) => {
    points = routed;
    return {
      routeGeometry: routed,
      legDurationSeconds: [600],
      updatedAt: new Date(now).toISOString(),
      stale: false,
    };
  });
  assert.deepEqual(points, [
    { lat: 41, lng: -73 },
    { id: "destination:40.7:-74", label: "Final destination", address: "Final destination",
      mapLabel: "", lat: 40.7, lng: -74, kind: "dropoff", scheduledAt: null },
  ]);
  assert.equal(result.trafficStatus, "live");
  assert.equal(result.stops.filter(stop => stop.id === "destination:40.7:-74").length, 1);
  assert.ok(result.stops.at(-1)?.estimatedArrivalAt);
});

test("after the last intermediate stop, live journey transitions to the final destination", async () => {
  const now = Date.parse("2026-09-20T13:00:00Z");
  const official = {
    runKey: "last-stop-run", originName: "Origin", destinationName: "Final",
    serviceDate: "2026-09-20", scheduledDepartureAt: null, scheduledArrivalAt: null,
    trafficDepartureAt: null,
    stops: [{ id: "last-stop", label: "Last stop", mapLabel: "A", lat: 41.1, lng: -73.9,
      kind: "pickup" as const, scheduledAt: null }],
  } as any;
  const trip = {
    status: "running", retiredAt: null, ownerSubject: "driver", officialRunKey: official.runKey,
    scheduledDepartureAt: new Date(now - 60_000), completedAt: null,
    currentLat: 41, currentLng: -73, locationUpdatedAt: new Date(now - 5_000),
    updatedAt: new Date(now), intermediateStops: [],
    destinationLat: 40.7, destinationLng: -74, destinationAddress: "Final",
  } as any;
  let routed: any[] = [];
  const result = await buildPassengerJourney(official, trip, now, async (_key, points) => {
    routed = points;
    return { routeGeometry: points, legDurationSeconds: [300], updatedAt: new Date(now).toISOString(), stale: false };
  });
  assert.deepEqual(routed.slice(1).map(point => point.id ?? point.label), ["destination:40.7:-74"]);
  assert.equal(result.trafficStatus, "live");
  assert.equal(result.stops.filter(stop => stop.id === "destination:40.7:-74").length, 1);
});

test("stale GPS does not claim live traffic and provider outage stays unavailable", async () => {
  const now = Date.parse("2026-09-20T13:00:00Z");
  const official = {
    runKey: "freshness-run", originName: "Origin", destinationName: "Final",
    serviceDate: "2026-09-20", scheduledDepartureAt: null, scheduledArrivalAt: null,
    trafficDepartureAt: null, stops: [],
  } as any;
  const baseTrip = {
    status: "running", retiredAt: null, ownerSubject: "driver", officialRunKey: official.runKey,
    scheduledDepartureAt: new Date(now - 60_000), completedAt: null,
    currentLat: 41, currentLng: -73, updatedAt: new Date(now), intermediateStops: [],
    destinationLat: 40.7, destinationLng: -74, destinationAddress: "Final",
  } as any;
  let calls = 0;
  const stale = await buildPassengerJourney(official, {
    ...baseTrip, locationUpdatedAt: new Date(now - 91_000),
  }, now, async () => {
    calls++;
    throw new Error("must not route stale GPS");
  });
  assert.equal(calls, 0);
  assert.equal(stale.trafficStatus, "unavailable");
  const outage = await buildPassengerJourney(official, {
    ...baseTrip, locationUpdatedAt: new Date(now - 5_000),
  }, now, async () => null);
  assert.equal(outage.trafficStatus, "unavailable");
  assert.equal(outage.message, "Awaiting a fresh live location update.");
});