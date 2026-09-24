import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { clerkClient } from "@clerk/express";
import { requireDriver } from "./driver-profile";

const state = {
  sessionStatus: "active",
  banned: false,
  locked: false,
  privateMetadata: { role: "driver" } as Record<string, unknown>,
};
let server: Server;
let baseUrl: string;

before(async () => {
  mock.method(clerkClient.sessions, "getSession", async () => ({
    id: "session",
    userId: "subject",
    status: state.sessionStatus,
  }) as never);
  mock.method(clerkClient.users, "getUser", async () => ({
    id: "subject",
    username: "assigned-driver",
    banned: state.banned,
    locked: state.locked,
    privateMetadata: state.privateMetadata,
  }) as never);
  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, {
      auth: Object.assign(() => ({
        userId: "subject",
        sessionId: "session",
        tokenType: "session_token",
        // Deliberately stale privileged claims: authorization must ignore these.
        sessionClaims: { role: "driver", driverAccess: true, username: "stale-name" },
      }), { [Symbol.for("@clerk/express.auth")]: true }),
      log: { error() {}, warn() {} },
    });
    next();
  });
  app.get("/driver-only", requireDriver, (_req, res) => {
    res.json({ username: res.locals.driverUsername });
  });
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

after(async () => {
  mock.restoreAll();
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test("fresh Clerk user and session state overrides old signed driver claims", async () => {
  state.sessionStatus = "revoked";
  assert.equal((await fetch(`${baseUrl}/driver-only`)).status, 403);
  state.sessionStatus = "active";
  state.privateMetadata = {};
  assert.equal((await fetch(`${baseUrl}/driver-only`)).status, 403);
  state.privateMetadata = { role: "driver" };
  state.banned = true;
  assert.equal((await fetch(`${baseUrl}/driver-only`)).status, 403);
  state.banned = false;
});

test("an admin explicitly provisioned with driverAccess remains allowed to drive", async () => {
  state.privateMetadata = { role: "admin", driverAccess: true };
  const response = await fetch(`${baseUrl}/driver-only`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { username: "assigned-driver" });
});