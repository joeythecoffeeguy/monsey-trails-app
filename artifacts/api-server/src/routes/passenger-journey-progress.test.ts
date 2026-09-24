import assert from "node:assert/strict";
import test from "node:test";
import { derivePassengerJourneyProgress } from "./passenger-alerts";

const official = Array.from({ length: 13 }, (_, index) => ({
  id: `stop-${index + 1}`, address: `Stop ${index + 1}`, lat: 40 + index / 100, lng: -74,
}));
const destination = { id: "destination", address: "Terminal", lat: 41, lng: -74 };

test("derives seven completed stops from a thirteen-stop official route", () => {
    const remaining = official.slice(7).map(stop => ({ ...stop, eta: null }));
    const progress = derivePassengerJourneyProgress(official, remaining, destination);
    assert.equal(progress.filter(stop => stop.status === "completed").length, 7);
    assert.equal(progress[7].status, "current");
    assert.equal(progress.slice(8, 13).every(stop => stop.status === "upcoming"), true);
    assert.equal(progress.at(-1)?.status, "final");
});

test("marks the complete journey completed without inventing timestamps", () => {
    const progress = derivePassengerJourneyProgress(official, [], destination, { completed: true });
    assert.equal(progress.length, 14);
    assert.equal(progress.every(stop => stop.status === "completed"), true);
    assert.equal(progress.some(stop => "completedAt" in stop), false);
});

test("fails safe when remaining IDs are not an ordered suffix", () => {
    const progress = derivePassengerJourneyProgress(official, [official[9], official[7]], destination);
    assert.deepEqual(progress, []);
});

test("preserves official pickup and dropoff semantics in completed progress", () => {
    const stops = [
        { ...official[0], kind: "pickup" as const },
        { ...official[1], kind: "dropoff" as const },
    ];
    const progress = derivePassengerJourneyProgress(stops, [stops[1]], destination);
    assert.equal(progress[0].kind, "pickup");
    assert.equal(progress[0].status, "completed");
    assert.equal(progress[1].kind, "dropoff");
});

test("does not infer completion semantics for legacy stops", () => {
    const progress = derivePassengerJourneyProgress(official, official.slice(1), destination);
    assert.equal(progress[0].kind, undefined);
});