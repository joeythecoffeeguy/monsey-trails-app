import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDriverNavigation,
  buildLatestDriverNavigation,
  filterImplausibleNavigationWaypoints,
  navigationSearchQueries,
  normalizeNavigationQuery,
  tomTomNavigationQuery,
  tomTomNavigationUrl,
} from "./trip";

test("normalizes common street-corner formats for navigation search", () => {
  assert.equal(
    normalizeNavigationQuery("Route 59 corner Route 45, Spring Valley, NY"),
    "Route 59 & Route 45, Spring Valley, NY",
  );
  assert.equal(
    normalizeNavigationQuery("Viola Road and Union Road, Monsey, NY"),
    "Viola Road & Union Road, Monsey, NY",
  );
  assert.equal(
    normalizeNavigationQuery("5th Ave & W 47th Street, New York, NY"),
    "5th Ave & W 47th Street, New York, NY",
  );
});

test("expands a colloquial Brooklyn lettered street into a local intersection query", () => {
  assert.deepEqual(
    navigationSearchQueries("Bedford Avenue corner U Street"),
    [
      "Bedford Avenue & Avenue U, Brooklyn, New York",
    ],
  );
});

test("formats intersections for TomTom and expands Rockland route aliases", () => {
  assert.equal(
    tomTomNavigationQuery("Bedford Avenue & Avenue U, Brooklyn, New York"),
    "Bedford Avenue Avenue U Brooklyn New York",
  );
  assert.equal(
    tomTomNavigationQuery("Route 59 & Route 45, Spring Valley, New York"),
    "West Route 59 Main Street Spring Valley New York",
  );
});

function navigationResponse(firstTurnOffset = 755) {
  return {
    routes: [{
      summary: {
        lengthInMeters: 5688,
        travelTimeInSeconds: 1061,
        noTrafficTravelTimeInSeconds: 848,
        trafficDelayInSeconds: 97,
        arrivalTime: "2026-09-17T15:09:12-04:00",
      },
      legs: [
        {
          points: [
            { latitude: 41.109068, longitude: -74.044419 },
            { latitude: 41.12, longitude: -74.06 },
          ],
        },
        {
          points: [
            { latitude: 41.12, longitude: -74.06 },
            { latitude: 41.138563, longitude: -74.082685 },
          ],
        },
      ],
      guidance: {
        instructions: [
          {
            instructionType: "LOCATION_DEPARTURE",
            maneuver: "DEPART",
            message: "Leave from South Main Street",
            routeOffsetInMeters: 0,
          },
          {
            instructionType: "TURN",
            maneuver: "TURN_LEFT",
            message: "Turn left onto Lawler Boulevard",
            routeOffsetInMeters: firstTurnOffset,
            pointIndex: 4,
            point: { latitude: 41.115, longitude: -74.05 },
          },
          {
            instructionType: "TURN",
            maneuver: "TURN_RIGHT",
            message: "Turn right onto North Madison Avenue",
            routeOffsetInMeters: 841,
            point: { latitude: 41.12, longitude: -74.06 },
          },
        ],
      },
      sections: [
        {
          sectionType: "SPEED_LIMIT",
          startPointIndex: 0,
          endPointIndex: 18,
          maxSpeedLimitInKmh: 32,
        },
      ],
    }],
  };
}

test("builds the live TomTom request with ordered waypoints and repeated section types", () => {
  const url = new URL(tomTomNavigationUrl([
    { lat: 41.1, lng: -74.01 },
    { lat: 41.2, lng: -74.02 },
    { lat: 41.3, lng: -74.03 },
  ], "test-key"));

  assert.equal(
    url.pathname,
    "/routing/1/calculateRoute/41.1,-74.01:41.2,-74.02:41.3,-74.03/json",
  );
  assert.equal(url.searchParams.get("travelMode"), "bus");
  assert.equal(url.searchParams.get("traffic"), "true");
  assert.deepEqual(url.searchParams.getAll("sectionType"), ["speedLimit", "lanes"]);
  assert.equal(url.searchParams.get("instructionRoadShieldReferences"), "all");
  assert.equal(url.searchParams.get("maxAlternatives"), "2");
});

test("excludes an impossible wrong-hemisphere waypoint from live guidance", () => {
  assert.deepEqual(filterImplausibleNavigationWaypoints([
    { lat: 41.0160347, lng: -73.8469453 },
    { lat: 40.705782, lng: -73.962861 },
    { lat: 40.701699, lng: 73.961625 },
    { lat: 41.1381882, lng: -74.0306377 },
  ]), [
    { lat: 41.0160347, lng: -73.8469453 },
    { lat: 40.705782, lng: -73.962861 },
    { lat: 41.1381882, lng: -74.0306377 },
  ]);
});

test("maps TomTom guidance into driver turns, route geometry, traffic, and legal speed", () => {
  const navigation = buildDriverNavigation(navigationResponse());

  assert.deepEqual(navigation.currentManeuver, {
    instruction: "Turn left onto Lawler Boulevard",
    distanceMiles: 755 / 1609.344,
    type: "turn",
    modifier: "left",
    laneGuidance: null,
    exitNumber: null,
    roadShields: [],
    signpostText: null,
  });
  assert.equal(navigation.nextManeuver?.instruction, "Turn right onto North Madison Avenue");
  assert.equal(navigation.nextManeuver?.modifier, "right");
  assert.equal(navigation.speedLimitMph, 20);
  assert.equal(navigation.trafficDelaySeconds, 213);
  assert.equal(navigation.remainingDistanceMiles, 5688 / 1609.344);
  assert.equal(navigation.travelTimeSeconds, 1061);
  assert.equal(navigation.arrivalTime, "2026-09-17T15:09:12-04:00");
  assert.deepEqual(navigation.routeGeometry, [
    { lat: 41.109068, lng: -74.044419 },
    { lat: 41.12, lng: -74.06 },
    { lat: 41.138563, lng: -74.082685 },
  ]);
  assert.deepEqual(navigation.alternatives, []);
});

test("exposes TomTom alternatives with their time difference from the current route", () => {
  const response = navigationResponse();
  response.routes.push({
    ...response.routes[0],
    summary: {
      ...response.routes[0].summary,
      travelTimeInSeconds: 881,
      arrivalTime: "2026-09-17T15:06:12-04:00",
    },
  });
  const navigation = buildDriverNavigation(response);
  assert.equal(navigation.alternatives.length, 1);
  assert.match(navigation.alternatives[0].id, /^alternative-[a-z0-9]+$/);
  assert.equal(navigation.alternatives[0].timeDifferenceSeconds, -180);
  assert.equal(navigation.alternatives[0].travelTimeSeconds, 881);
});

test("keeps a selected corridor current after the GPS origin moves and TomTom reorders routes", () => {
  const initial = navigationResponse();
  const alternate = structuredClone(initial.routes[0]);
  alternate.summary.travelTimeInSeconds = 881;
  alternate.legs[0].points = [
    { latitude: 41.109068, longitude: -74.044419 },
    { latitude: 41.119, longitude: -74.046 },
    { latitude: 41.132, longitude: -74.061 },
  ];
  alternate.legs[1].points = [
    { latitude: 41.132, longitude: -74.061 },
    { latitude: 41.138563, longitude: -74.082685 },
  ];
  initial.routes.push(alternate);
  const first = buildDriverNavigation(initial);
  const chosen = first.alternatives[0];

  const refreshed = navigationResponse();
  const refreshedChosen = structuredClone(alternate);
  refreshedChosen.legs[0].points[0] = { latitude: 41.112, longitude: -74.045 };
  refreshed.routes = [refreshedChosen, refreshed.routes[0]];
  const result = buildDriverNavigation(refreshed, { id: chosen.id, corridor: chosen.routeGeometry });

  assert.equal(result.currentRouteId, chosen.id);
  assert.deepEqual(result.routeGeometry.slice(-2), chosen.routeGeometry.slice(-2));
});

test("uses the selected alternative's lane guidance instead of the primary route's lanes", () => {
  const response = navigationResponse();
  response.routes[0].sections.push({
    sectionType: "LANES",
    startPointIndex: 3,
    endPointIndex: 5,
    lanes: [
      { directions: ["LEFT"], follow: "LEFT" },
      { directions: ["RIGHT"] },
    ],
    laneSeparators: ["SINGLE_SOLID"],
  } as unknown as (typeof response.routes)[number]["sections"][number]);
  const alternate = structuredClone(response.routes[0]);
  alternate.summary.travelTimeInSeconds = 881;
  alternate.legs[0].points = [
    { latitude: 41.109068, longitude: -74.044419 },
    { latitude: 41.119, longitude: -74.046 },
    { latitude: 41.132, longitude: -74.061 },
  ];
  alternate.sections = [
    response.routes[0].sections[0],
    {
      sectionType: "LANES",
      startPointIndex: 3,
      endPointIndex: 5,
      lanes: [
        { directions: ["LEFT"] },
        { directions: ["RIGHT"], follow: "RIGHT" },
      ],
      laneSeparators: ["SINGLE_DASHED"],
    },
  ] as unknown as typeof alternate.sections;
  response.routes.push(alternate);
  const alternative = buildDriverNavigation(response).alternatives[0];

  const selected = buildDriverNavigation(response, {
    id: alternative.id,
    corridor: alternative.routeGeometry,
  });

  assert.equal(selected.currentRouteId, alternative.id);
  assert.deepEqual(selected.currentManeuver?.laneGuidance, {
    lanes: [
      { directions: ["LEFT"], follow: null },
      { directions: ["RIGHT"], follow: "RIGHT" },
    ],
    laneSeparators: ["SINGLE_DASHED"],
  });
});

test("an in-flight navigation refresh applies a newer driver selection before caching", async () => {
  const response = navigationResponse();
  const alternate = structuredClone(response.routes[0]);
  alternate.summary.travelTimeInSeconds = 881;
  alternate.legs[0].points = [
    { latitude: 41.109068, longitude: -74.044419 },
    { latitude: 41.119, longitude: -74.046 },
    { latitude: 41.132, longitude: -74.061 },
  ];
  alternate.legs[1].points = [
    { latitude: 41.132, longitude: -74.061 },
    { latitude: 41.138563, longitude: -74.082685 },
  ];
  response.routes.push(alternate);
  const chosen = buildDriverNavigation(response).alternatives[0];
  let selectionState: {
    selection?: { id: string; corridor: Array<{ lat: number; lng: number }> };
    version: number;
  } = { version: 0 };
  let resolveTomTom!: (body: typeof response) => void;
  const delayedTomTom = new Promise<typeof response>(resolve => {
    resolveTomTom = resolve;
  });

  const inFlight = buildLatestDriverNavigation(delayedTomTom, () => selectionState);
  selectionState = {
    selection: { id: chosen.id, corridor: chosen.routeGeometry },
    version: 1,
  };
  resolveTomTom(response);
  const result = await inFlight;

  assert.equal(result.selectionVersion, 1);
  assert.equal(result.navigation.currentRouteId, chosen.id);
  assert.deepEqual(result.navigation.routeGeometry, chosen.routeGeometry);
});

test("retains only TomTom-verified lane, exit, shield, and signpost guidance", () => {
  const response = navigationResponse();
  const route = response.routes[0];
  Object.assign(route.guidance.instructions[1], {
    instructionType: "EXIT",
    maneuver: "KEEP_RIGHT",
    exitNumber: "14B",
    roadShieldReferences: [{
      reference: "usa-ny-state-route",
      shieldContent: "45",
    }],
    signpostRoadShieldReferences: [{
      reference: "usa-county-highway",
      shieldContent: "74",
    }],
    signpostText: "Mahwah",
  });
  route.sections.push({
    sectionType: "LANES",
    startPointIndex: 3,
    endPointIndex: 5,
    lanes: [
      { directions: ["LEFT"] },
      { directions: ["RIGHT"], follow: "RIGHT" },
    ],
    laneSeparators: ["DOUBLE_SOLID", "SINGLE_SOLID", "SINGLE_SOLID"],
  } as unknown as (typeof route.sections)[number]);

  assert.deepEqual(buildDriverNavigation(response).currentManeuver, {
    instruction: "Turn left onto Lawler Boulevard",
    distanceMiles: 755 / 1609.344,
    type: "fork",
    modifier: "right",
    laneGuidance: {
      lanes: [
        { directions: ["LEFT"], follow: null },
        { directions: ["RIGHT"], follow: "RIGHT" },
      ],
      laneSeparators: ["DOUBLE_SOLID", "SINGLE_SOLID", "SINGLE_SOLID"],
    },
    exitNumber: "14B",
    roadShields: [
      { reference: "usa-ny-state-route", shieldContent: "45", affixes: [] },
      { reference: "usa-county-highway", shieldContent: "74", affixes: [] },
    ],
    signpostText: "Mahwah",
  });
});

test("does not expose lane advice when TomTom supplies no recommended lane", () => {
  const response = navigationResponse();
  response.routes[0].sections.push({
    sectionType: "LANES",
    startPointIndex: 3,
    endPointIndex: 5,
    lanes: [
      { directions: ["STRAIGHT"] },
      { directions: ["RIGHT"] },
    ],
    laneSeparators: ["SINGLE_DASHED"],
  } as unknown as (typeof response.routes)[number]["sections"][number]);

  assert.equal(buildDriverNavigation(response).currentManeuver?.laneGuidance, null);
});

test("keeps a spoken prompt identity stable while its remaining distance changes", () => {
  const farther = buildDriverNavigation(navigationResponse(755));
  const closer = buildDriverNavigation(navigationResponse(210));

  assert.notEqual(farther.currentManeuver?.distanceMiles, closer.currentManeuver?.distanceMiles);
  assert.equal(farther.voicePromptId, closer.voicePromptId);
});

test("fails explicitly when TomTom returns no usable route", () => {
  assert.throws(
    () => buildDriverNavigation({ routes: [] }),
    /returned no route/i,
  );
});
