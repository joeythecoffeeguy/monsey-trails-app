import assert from "node:assert/strict";
import test from "node:test";
import {
  isMonseyTrailsServiceCoordinate,
  repairMissingWesternLongitude,
} from "./route-coordinates";

test("repairs an obvious missing western longitude sign near the active route", () => {
  assert.deepEqual(
    repairMissingWesternLongitude(
      { lat: 40.701699, lng: 73.961625 },
      [
        { lat: 40.912888, lng: -74.042983 },
        { lat: 40.705782, lng: -73.962861 },
      ],
    ),
    { lat: 40.701699, lng: -73.961625 },
  );
});

test("does not alter a positive longitude without strong route evidence", () => {
  assert.deepEqual(
    repairMissingWesternLongitude(
      { lat: 40.701699, lng: 73.961625 },
      [{ lat: 40.7, lng: 74 }],
    ),
    { lat: 40.701699, lng: 73.961625 },
  );
});

test("accepts service-region coordinates and rejects a wrong hemisphere", () => {
  assert.equal(isMonseyTrailsServiceCoordinate({ lat: 40.701699, lng: -73.961625 }), true);
  assert.equal(isMonseyTrailsServiceCoordinate({ lat: 40.701699, lng: 73.961625 }), false);
});