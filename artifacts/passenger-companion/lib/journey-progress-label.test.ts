import assert from "node:assert/strict";
import test from "node:test";
import { journeyCompletionLabel } from "./journey-progress-label.ts";

test("uses official pickup and dropoff semantics for completed copy", () => {
  assert.equal(journeyCompletionLabel("completed", "pickup"), "Departed");
  assert.equal(journeyCompletionLabel("completed", "dropoff"), "Arrived");
  assert.equal(journeyCompletionLabel("completed", "destination"), "Arrived");
});

test("legacy or incomplete stops remain neutral", () => {
  assert.equal(journeyCompletionLabel("completed"), "Arrived");
  assert.equal(journeyCompletionLabel("current", "pickup"), null);
});