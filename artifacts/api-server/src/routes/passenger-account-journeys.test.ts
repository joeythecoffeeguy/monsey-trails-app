import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import type { PassengerAccountJourneyRow } from "@workspace/db";
import { createPassengerAccountJourneysRouter } from "./passenger-account-journeys";

let server: Server;
let baseUrl: string;
const journeys = new Map<string, PassengerAccountJourneyRow[]>();
let idCounter = 1;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use(createPassengerAccountJourneysRouter({
    getAuth: (req) => ({
      userId: req.header("x-test-user") ?? null,
      sessionId: req.header("x-test-session") ?? null,
    }),
    getSession: async (sessionId) => ({
      status: "active",
      userId: sessionId === "mismatched-session" ? "some-other-user" : sessionId.replace(/^session:/, ""),
    }),
    getUser: async () => ({ banned: false, locked: false }),
    list: async (subject) => journeys.get(subject) ?? [],
    save: async (subject, input) => {
      const rows = journeys.get(subject) ?? [];
      const routeKey = JSON.stringify([input.line, input.origin, input.destination, input.pickup?.id ?? null, input.dropoff?.id ?? null]);
      const existing = rows.find(row => row.routeKey === routeKey);
      if (existing) return existing;
      const row = {
        id: `00000000-0000-4000-8000-${String(idCounter++).padStart(12, "0")}`,
        clerkSubject: subject,
        routeKey,
        line: input.line,
        origin: input.origin,
        destination: input.destination,
        label: input.label,
        pickup: input.pickup ?? null,
        dropoff: input.dropoff ?? null,
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      } as PassengerAccountJourneyRow;
      rows.push(row);
      journeys.set(subject, rows);
      return row;
    },
    remove: async (subject, id) => {
      const rows = journeys.get(subject) ?? [];
      const index = rows.findIndex(row => row.id === id);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
  }));
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
    server.once("error", reject);
  });
});

after(async () => {
  if (server.listening) await new Promise<void>((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve()));
});

function accountHeaders(subject: string) {
  return { "content-type": "application/json", "x-test-user": subject, "x-test-session": `session:${subject}` };
}

test("saved account journeys require a matching active session and remain account-owned", async () => {
  const anonymous = await fetch(`${baseUrl}/passenger/account/journeys`);
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get("cache-control"), "no-store");
  const anonymousSave = await fetch(`${baseUrl}/passenger/account/journeys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ line: 1, origin: 1, destination: 2, label: "Trip" }),
  });
  assert.equal(anonymousSave.status, 401);

  const mismatch = await fetch(`${baseUrl}/passenger/account/journeys`, {
    headers: { "x-test-user": "alice", "x-test-session": "mismatched-session" },
  });
  assert.equal(mismatch.status, 403);

  const payload = {
    line: 2,
    origin: 1,
    destination: 5,
    label: "  Work  ",
    pickup: { id: "pick-1", label: "Main Street", kind: "pickup", lat: 41.1, lng: -74.2 },
  };
  const firstResponse = await fetch(`${baseUrl}/passenger/account/journeys`, {
    method: "POST", headers: accountHeaders("alice"), body: JSON.stringify(payload),
  });
  assert.equal(firstResponse.status, 200);
  const first = (await firstResponse.json() as { journey: { id: string; label: string } }).journey;
  assert.equal(first.label, "Work");

  const repeatedResponse = await fetch(`${baseUrl}/passenger/account/journeys`, {
    method: "POST", headers: accountHeaders("alice"),
    body: JSON.stringify({ ...payload, label: "Renamed" }),
  });
  const repeated = (await repeatedResponse.json() as { journey: { id: string } }).journey;
  assert.equal(repeated.id, first.id, "same route selection must be idempotent");

  const foreignDelete = await fetch(`${baseUrl}/passenger/account/journeys/${first.id}`, {
    method: "DELETE", headers: accountHeaders("bob"),
  });
  assert.equal(foreignDelete.status, 404);
  const aliceList = await fetch(`${baseUrl}/passenger/account/journeys`, { headers: accountHeaders("alice") });
  assert.equal((await aliceList.json() as { journeys: unknown[] }).journeys.length, 1);
  const bobList = await fetch(`${baseUrl}/passenger/account/journeys`, { headers: accountHeaders("bob") });
  assert.equal((await bobList.json() as { journeys: unknown[] }).journeys.length, 0);

  for (const pickup of [
    { id: "bad", label: "Outside", kind: "pickup", lat: 91, lng: 0 },
    { id: "bad", label: "Outside", kind: "pickup", lat: 0, lng: 181 },
    { id: "bad", label: "Outside", kind: "pickup", lat: 0, lng: 0, extra: "nope" },
  ]) {
    const invalid = await fetch(`${baseUrl}/passenger/account/journeys`, {
      method: "POST", headers: accountHeaders("alice"),
      body: JSON.stringify({ ...payload, pickup }),
    });
    assert.equal(invalid.status, 400);
  }
});