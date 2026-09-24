import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import app from "../app";
import { pool } from "@workspace/db";
import { canonicalizeSourceHtml, claimWebsiteCheck, DEFAULT_LOCALIZED_PASSENGER_INFO, DEFAULT_PASSENGER_INFO, fingerprintSourcePages, issueStaffToken, normalizeContent, verifyStaffToken } from "./passenger-info";

let server: Server;
let baseUrl: string;
const sessionSecret = "passenger-info-session-test-secret";
const adminKey = "passenger-info-admin-test-key";
let staffCookie = "";

before(async () => {
  process.env.SESSION_SECRET = sessionSecret;
  process.env.PASSENGER_INFO_ADMIN_KEY = adminKey;
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
      resolve();
    });
    server.once("error", reject);
  });
});

after(async () => {
  if (server.listening) await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

test("passenger information exposes its review status and requires explicit valid approval", async () => {
  const currentResponse = await fetch(`${baseUrl}/passenger-info`);
  assert.equal(currentResponse.status, 200);
  const current = await currentResponse.json() as {
    content: Record<string, Record<string, Array<{ title: string; text: string }>>>;
    reviewedAt: string;
    stale: boolean;
    changesDetected: boolean;
    sourceUrls: string[];
    canManage: boolean;
  };
  assert.ok(current.reviewedAt);
  assert.equal(typeof current.stale, "boolean");
  assert.equal(typeof current.changesDetected, "boolean");
  assert.equal(current.sourceUrls.some((url) => url.includes("/information")), true);
  assert.equal(current.sourceUrls.some((url) => url.includes("/rates")), true);
  assert.equal(current.content.en.fares.length > 0, true);
  assert.notEqual(DEFAULT_LOCALIZED_PASSENGER_INFO.yi.destinations[0].text, DEFAULT_PASSENGER_INFO.destinations[0].text);
  assert.notEqual(DEFAULT_LOCALIZED_PASSENGER_INFO.he.fares[1].text, DEFAULT_PASSENGER_INFO.fares[1].text);
  assert.equal(DEFAULT_LOCALIZED_PASSENGER_INFO.yi.guide[0].text.includes(DEFAULT_PASSENGER_INFO.guide[0].text), false);
  assert.equal(DEFAULT_LOCALIZED_PASSENGER_INFO.he.contact[3].text.includes(DEFAULT_PASSENGER_INFO.contact[3].text), false);
  assert.equal(current.canManage, false);

  const anonymousApproval = await fetch(`${baseUrl}/passenger-info`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: current.content }),
  });
  assert.equal(anonymousApproval.status, 401);
  const anonymousCheck = await fetch(`${baseUrl}/passenger-info/check`, { method: "POST" });
  assert.equal(anonymousCheck.status, 401);

  const login = await fetch(`${baseUrl}/passenger-info/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: adminKey }),
  });
  assert.equal(login.status, 204);
  staffCookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.match(staffCookie, /^passenger_info_staff=/);

  const invalid = await fetch(`${baseUrl}/passenger-info`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: staffCookie },
    body: JSON.stringify({ content: { fares: [] } }),
  });
  assert.equal(invalid.status, 400);

  const approval = await fetch(`${baseUrl}/passenger-info`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: staffCookie },
    body: JSON.stringify({ content: current.content }),
  });
  assert.equal(approval.status, 200);
  const approved = await approval.json() as { reviewedAt: string; stale: boolean };
  assert.equal(approved.stale, false);
  assert.ok(Date.parse(approved.reviewedAt) >= Date.now() - 10_000);
});

test("website checks are throttled before outbound requests begin", () => {
  const now = Date.now() + 10 * 60_000;
  assert.equal(claimWebsiteCheck(now), true);
  assert.equal(claimWebsiteCheck(now + 1_000), false);
});

test("legacy passenger content gets bundled translations only when it is unchanged", () => {
  const baseline = normalizeContent(DEFAULT_PASSENGER_INFO);
  assert.equal(baseline.en.destinations[0].text, DEFAULT_PASSENGER_INFO.destinations[0].text);
  assert.notEqual(baseline.yi.destinations[0].text, DEFAULT_PASSENGER_INFO.destinations[0].text);
  const customized = structuredClone(DEFAULT_PASSENGER_INFO);
  customized.fares[0].text = "Staff-approved custom fare wording";
  const preserved = normalizeContent(customized);
  assert.equal(preserved.en.fares[0].text, "Staff-approved custom fare wording");
  assert.equal(preserved.yi.fares[0].text, "Staff-approved custom fare wording");
  assert.equal(preserved.he.fares[0].text, "Staff-approved custom fare wording");
});

test("source fingerprints ignore volatile hidden tokens but retain visible policy changes", () => {
  const first = `<html><head><meta name="csrf-token" content="abc"></head><body>
    <script>window.csrf = "abc"</script><main><h1>Ticket refunds</h1><p>Cash fares are non-refundable.</p></main></body></html>`;
  const second = `<html><head><meta name="csrf-token" content="different"></head><body>
    <script>window.csrf = "different"</script><main><h1>Ticket refunds</h1><p>Cash fares are non-refundable.</p></main></body></html>`;
  const changed = second.replace("non-refundable", "refundable within 24 hours");
  assert.equal(canonicalizeSourceHtml(first), canonicalizeSourceHtml(second));
  assert.notEqual(canonicalizeSourceHtml(second), canonicalizeSourceHtml(changed));
});

test("combined source fingerprint changes when a visible published fare changes", () => {
  const homepage = "<main>Monsey Trails destinations</main>";
  const information = "<main>Ticket books do not expire.</main>";
  const contact = "<main>Call 845-510-5100</main>";
  const rates = `<head><meta name="csrf-token" content="first"></head>
    <main><h1>Rates</h1><p>Manhattan $17</p><p>Boro Park $20</p></main>`;
  const sameRatesWithNewToken = rates.replace("first", "second");
  const changedRates = sameRatesWithNewToken.replace("Manhattan $17", "Manhattan $18");

  const approved = fingerprintSourcePages([homepage, rates, information, contact]);
  assert.equal(approved, fingerprintSourcePages([homepage, sameRatesWithNewToken, information, contact]));
  assert.notEqual(approved, fingerprintSourcePages([homepage, changedRates, information, contact]));
});

test("staff session tokens expire on the server", () => {
  const now = Date.now();
  const token = issueStaffToken(now);
  assert.equal(verifyStaffToken(token, now + 1_000), true);
  assert.equal(verifyStaffToken(token, now + 8 * 60 * 60 * 1_000 + 1), false);
});