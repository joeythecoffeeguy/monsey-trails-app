import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearTomTomRoutingCooldownForTest,
  fetchTomTomRoute,
  TomTomRoutingUnavailableError,
} from "./tomtom-routing";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearTomTomRoutingCooldownForTest();
});

test("provider denial opens a bounded cooldown and prevents request storms", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return new Response(JSON.stringify({
      detailedError: { code: "InsufficientFunds" },
    }), { status: 403 });
  };

  const concurrent = await Promise.allSettled([
    fetchTomTomRoute("https://api.tomtom.com/routing/1/calculateRoute/example/json"),
    fetchTomTomRoute("https://api.tomtom.com/routing/1/calculateRoute/concurrent/json"),
  ]);
  assert.equal(concurrent.every(result => result.status === "rejected"), true);
  assert.equal(calls, 1, "concurrent callers share the provider availability check");
  await assert.rejects(
    fetchTomTomRoute("https://api.tomtom.com/routing/1/calculateRoute/another/json"),
    (error: unknown) => error instanceof TomTomRoutingUnavailableError
      && error.status === 503
      && error.retryAfterSeconds > 0
      && error.retryAfterSeconds <= 300,
  );
  assert.equal(calls, 1);
});

test("successful routing remains available when no cooldown is active", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("{}", { status: 200 });
  };

  assert.equal((await fetchTomTomRoute("https://api.tomtom.com/routing/1/calculateRoute/a/json")).status, 200);
  assert.equal((await fetchTomTomRoute("https://api.tomtom.com/routing/1/calculateRoute/b/json")).status, 200);
  assert.equal(calls, 2);
});

test("network failures open a transient cooldown", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new DOMException("timed out", "TimeoutError");
  };

  await assert.rejects(
    fetchTomTomRoute("https://api.tomtom.com/routing/1/calculateRoute/timeout/json"),
    { name: "TimeoutError" },
  );
  await assert.rejects(
    fetchTomTomRoute("https://api.tomtom.com/routing/1/calculateRoute/retry/json"),
    (error: unknown) => error instanceof TomTomRoutingUnavailableError
      && error.status === 503
      && error.retryAfterSeconds <= 15,
  );
  assert.equal(calls, 1);
});