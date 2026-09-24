import assert from "node:assert/strict";
import { test } from "node:test";
import { isTrustedDriverRequest } from "./driver-request-origin";

function request(headers: Record<string, string> = {}, method = "POST", remoteAddress = "127.0.0.1") {
  return {
    method, protocol: "http", headers: { host: "localhost:5000", ...headers }, socket: { remoteAddress },
  } as Parameters<typeof isTrustedDriverRequest>[0];
}

test("driver CSRF policy accepts same-origin and native requests, rejects browser cross-origin requests", () => {
  assert.equal(isTrustedDriverRequest(request(), []), true);
  assert.equal(isTrustedDriverRequest(request({ origin: "http://localhost:5000", "sec-fetch-site": "same-origin" }), []), true);
  assert.equal(isTrustedDriverRequest(request({ origin: "https://attacker.example" }), []), false);
  assert.equal(isTrustedDriverRequest(request({ origin: "null" }), []), false);
  assert.equal(isTrustedDriverRequest(request({ "sec-fetch-site": "cross-site" }), []), false);
  assert.equal(isTrustedDriverRequest(request({ "sec-fetch-site": "same-site" }), []), false);
  assert.equal(isTrustedDriverRequest(request({ origin: "http://localhost:5000", "sec-fetch-site": "cross-site" }), []), false);
  assert.equal(isTrustedDriverRequest(request({ "sec-fetch-site": "none" }), []), false);
  assert.equal(isTrustedDriverRequest(request({ "sec-fetch-site": "none" }, "GET"), []), true);
  // Protect private GET responses as well as writes despite permissive public CORS.
  assert.equal(isTrustedDriverRequest(request({ origin: "https://attacker.example" }, "GET"), []), false);
});

test("proxy origin checks honor only trusted gateway protocol and explicitly configured forwarded domains", () => {
  const origin = "https://coach.example";
  const headers = { origin, "x-forwarded-host": "coach.example", "x-forwarded-proto": "https", "sec-fetch-site": "same-origin" };
  assert.equal(isTrustedDriverRequest(request(headers), [origin]), true);
  assert.equal(isTrustedDriverRequest(request(headers), []), false);
  assert.equal(isTrustedDriverRequest(request({ ...headers, host: "coach.example" }), []), true);
  assert.equal(isTrustedDriverRequest(request({ ...headers, host: "coach.example" }, "POST", "203.0.113.5"), []), false);
  assert.equal(isTrustedDriverRequest(request({
    ...headers, origin: "https://attacker.example", "x-forwarded-host": "attacker.example",
  }), [origin]), false);
});