import assert from "node:assert/strict";
import { test } from "node:test";
import {
  integratedScheduleStops,
  knownStop,
} from "./schedule";

const route8Dropoffs = [
  ["Maple Avenue & Route 45", 41.117476, -74.044177],
  ["Maple Avenue & Twin Avenue", 41.117161, -74.050228],
  ["Maple Avenue & Decatur Avenue", 41.116979, -74.054589],
  ["Route 59 & Remsen Avenue", 41.10911412, -74.08070326],
  ["Grove Street & Saddle River Road", 41.110945, -74.071434],
  ["Route 306 & Maple Avenue", 41.116215, -74.0688627],
] as const;

test("Route 8 Rockland additions are catalog-only drop-offs at verified coordinates", () => {
  const catalog = integratedScheduleStops();

  for (const [canonicalLabel, lat, lng] of route8Dropoffs) {
    assert.deepEqual(
      catalog.find(stop => stop.areaId === 2 && stop.canonicalLabel === canonicalLabel),
      {
        areaId: 2,
        areaName: "Monsey",
        sourceLabel: canonicalLabel,
        canonicalLabel,
        lat,
        lng,
        category: "dropoff",
      },
    );
  }
});

test("Route 8 intersections follow the shared New Square and Monsey resolver scope", () => {
  for (const [canonicalLabel, lat, lng] of route8Dropoffs) {
    for (const areaId of [1, 2]) {
      assert.deepEqual(knownStop(canonicalLabel, areaId), {
        label: canonicalLabel,
        lat,
        lng,
        passengerLabel: canonicalLabel,
      });
    }
    assert.equal(
      knownStop(canonicalLabel, 3),
      null,
      `${canonicalLabel} must not leak into Boro Park`,
    );
  }

  assert.deepEqual(
    knownStop("Remsen Avenue & Route 59", 2),
    {
      label: "Remsen Avenue & Route 59",
      lat: 41.10911412,
      lng: -74.08070326,
      passengerLabel: "Route 59 & Remsen Avenue",
    },
  );
});

test("Route 306 and Monsey Boulevard retain distinct Maple Avenue stops", () => {
  assert.deepEqual(knownStop("Route 306 & Maple Avenue", 2), {
    label: "Route 306 & Maple Avenue",
    lat: 41.116215,
    lng: -74.0688627,
    passengerLabel: "Route 306 & Maple Avenue",
  });
  assert.deepEqual(knownStop("Monsey Boulevard & Maple Avenue", 2), {
    label: "Monsey Boulevard & Maple Avenue",
    lat: 41.1164,
    lng: -74.0622,
    passengerLabel: "Monsey Boulevard & Maple Avenue",
  });
  assert.notDeepEqual(
    knownStop("Route 306 & Maple Avenue", 2),
    knownStop("Monsey Boulevard & Maple Avenue", 2),
  );
});