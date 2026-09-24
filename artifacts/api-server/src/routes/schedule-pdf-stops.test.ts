import assert from "node:assert/strict";
import { test } from "node:test";
import {
  auditedBoroParkStopLines,
  integratedScheduleStops,
  knownStop,
} from "./schedule";

const catalogStop = (areaId: number, label: string) =>
  integratedScheduleStops().find(stop => (
    stop.areaId === areaId && stop.canonicalLabel === label
  ));

test("PDF Manhattan and Williamsburg stops use independent MTA pins and catalog roles", () => {
  assert.deepEqual(catalogStop(5, "5th Avenue & 46th Street"), {
    areaId: 5,
    areaName: "Manhattan",
    sourceLabel: "5th Avenue & 46th Street",
    canonicalLabel: "5th Avenue & 46th Street",
    lat: 40.756156,
    lng: -73.979047,
    category: "dropoff",
  });
  assert.deepEqual(catalogStop(4, "Bedford Avenue & Taylor Street"), {
    areaId: 4,
    areaName: "Williamsburg",
    sourceLabel: "Bedford Avenue & Taylor Street",
    canonicalLabel: "Bedford Avenue & Taylor Street",
    lat: 40.705825,
    lng: -73.962904,
    category: "both",
  });
  assert.deepEqual(
    knownStop("Bedford Avenue & Wilson Street", 4),
    {
      label: "Bedford Avenue & Wilson Street",
      lat: 40.7053505,
      lng: -73.958891,
      passengerLabel: "Bedford Avenue & Wilson Street",
    },
    "the Taylor evidence must not relabel the existing Wilson pin",
  );
  assert.equal(knownStop("5th Avenue & 46th Street", 3), null);
  assert.equal(knownStop("Bedford Avenue & Taylor Street", 5), null);
});

test("PDF Boro Park 50th Street drop-offs use directional B11 stop coordinates", () => {
  const expected = [
    ["50th Street & Fort Hamilton Parkway", 40.637656, -73.998083],
    ["50th Street & 11th Avenue", 40.636887, -73.996815],
    ["50th Street & New Utrecht Avenue", 40.635485, -73.994491],
    ["50th Street & 13th Avenue", 40.634173, -73.992311],
    ["50th Street & 14th Avenue", 40.632924, -73.990247],
    ["50th Street & 15th Avenue", 40.631556, -73.987988],
    ["50th Street & 16th Avenue", 40.630239, -73.985805],
    ["50th Street & 17th Avenue", 40.62874, -73.983327],
    ["50th Street & 18th Avenue — drop-off", 40.627499, -73.981263],
  ] as const;

  for (const [label, lat, lng] of expected) {
    const stop = catalogStop(3, label);
    assert.ok(stop, label);
    assert.deepEqual(
      { lat: stop.lat, lng: stop.lng, category: stop.category },
      { lat, lng, category: "dropoff" },
    );
    assert.equal(knownStop(label, 4), null, `${label} must remain scoped to Boro Park`);
  }

  assert.deepEqual(
    catalogStop(3, "18th Avenue & 50th Street"),
    {
      areaId: 3,
      areaName: "Boro Park",
      sourceLabel: "18th Avenue & 50th Street",
      canonicalLabel: "18th Avenue & 50th Street",
      lat: 40.62793,
      lng: -73.981252,
      category: "both",
    },
    "the legacy combined pickup/drop-off catalog entry remains compatible",
  );
  assert.equal(catalogStop(3, "18th Avenue & 49th Street")?.category, "pickup");
});

test("catalog-only PDF additions do not change rider-confirmed Boro Park route templates", () => {
  assert.deepEqual(
    auditedBoroParkStopLines(
      "Starts at 18th Avenue between 50th/49th, then along 49th through Fort Hamilton Pkwy",
      1,
    ),
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
    auditedBoroParkStopLines(
      "49th by 18th, then every bus stop through Fort Hamilton Parkway",
      3,
    )?.slice(0, 2),
    ["18th Avenue & 49th Street", "17th Avenue & 49th Street"],
  );
});