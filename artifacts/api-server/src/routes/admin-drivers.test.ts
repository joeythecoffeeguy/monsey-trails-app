import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { clerkClient } from "@clerk/express";
import { db, driverProfilesTable, liveTripsTable } from "@workspace/db";
import adminDriversRouter, { resolveDriverName } from "./admin-drivers";
import adminStopsRouter from "./admin-stops";

type TestUser = {
  id: string;
  username: string | null;
  firstName?: string | null;
  lastName?: string | null;
  banned: boolean;
  locked: boolean;
  privateMetadata: Record<string, unknown>;
  publicMetadata?: Record<string, unknown>;
  unsafeMetadata?: Record<string, unknown>;
};

const users = new Map<string, TestUser>([
  ["admin", { id: "admin", username: "fleet-admin", banned: false, locked: false, privateMetadata: { role: "admin" } }],
  ["dispatcher", { id: "dispatcher", username: "dispatcher", banned: false, locked: false, privateMetadata: { role: "dispatcher" } }],
  ["content", { id: "content", username: "content-editor", banned: false, locked: false, privateMetadata: { role: "content" } }],
  ["banned-admin", { id: "banned-admin", username: "banned-admin", banned: true, locked: false, privateMetadata: { role: "admin" } }],
  ["locked-admin", { id: "locked-admin", username: "locked-admin", banned: false, locked: true, privateMetadata: { role: "admin" } }],
  ["inactive-admin", { id: "inactive-admin", username: "inactive-admin", banned: false, locked: false, privateMetadata: { role: "admin" } }],
  ["mismatch-admin", { id: "mismatch-admin", username: "mismatch-admin", banned: false, locked: false, privateMetadata: { role: "admin" } }],
  ["not-admin", { id: "not-admin", username: "claim-admin", banned: false, locked: false, privateMetadata: {}, unsafeMetadata: { role: "admin" } }],
  ["driver", { id: "driver", username: "driver-one", banned: false, locked: false, privateMetadata: { role: "driver", driverAccess: true } }],
  ["flag-driver", { id: "flag-driver", username: "driver-two", banned: false, locked: false, privateMetadata: { driverAccess: true, displayName: "Legacy Driver" } }],
  ["delete-driver", { id: "delete-driver", username: "driver-delete", lastName: "Partial", banned: false, locked: false, privateMetadata: { role: "driver", driverAccess: true } }],
  ["other", { id: "other", username: "passenger", banned: false, locked: false, privateMetadata: {} }],
]);
const calls = {
  created: [] as unknown[],
  banned: [] as string[],
  updated: [] as unknown[],
  unbanned: [] as string[],
  unlocked: [] as string[],
  revoked: [] as string[],
  deleted: [] as string[],
  events: [] as string[],
};
let failUnban = false;
let failRetire = false;
let failDeleteUser = false;
let createFailure: unknown = null;
let server: Server;
let baseUrl: string;

function asClerkUser(user: TestUser) {
  return user as never;
}

function request(path: string, options: {
  user?: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
} = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      origin: baseUrl.replace(/\/api$/, ""),
      "sec-fetch-site": "same-origin",
      ...(options.user ? { "x-test-user": options.user } : {}),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

before(async () => {
  mock.method(clerkClient.users, "getUser", async (id: string) => {
    const user = users.get(id);
    if (!user) throw { clerkError: true, errors: [{ code: "resource_not_found" }] };
    return asClerkUser(user);
  });
  mock.method(clerkClient.users, "getUserList", async ({ offset = 0, limit = 10 }) => ({
    data: [...users.values()].slice(offset, offset + limit).map(asClerkUser),
    totalCount: users.size,
  }));
  mock.method(clerkClient.users, "createUser", async (input: Record<string, unknown>) => {
    if (createFailure) throw createFailure;
    calls.created.push(input);
    const user = {
      id: "created-driver",
      username: input.username as string,
      banned: false,
      locked: false,
      privateMetadata: input.privateMetadata as Record<string, unknown>,
    };
    users.set(user.id, user);
    return asClerkUser(user);
  });
  mock.method(clerkClient.users, "banUser", async (id: string) => {
    calls.banned.push(id);
    calls.events.push(`ban:${id}`);
    const user = users.get(id)!;
    user.banned = true;
    return asClerkUser(user);
  });
  mock.method(clerkClient.users, "updateUser", async (id: string, input: unknown) => {
    calls.updated.push({ id, input });
    return asClerkUser(users.get(id)!);
  });
  mock.method(clerkClient.users, "unbanUser", async (id: string) => {
    calls.unbanned.push(id);
    if (failUnban) throw { clerkError: true, errors: [{ code: "api_error" }] };
    const user = users.get(id)!;
    user.banned = false;
    return asClerkUser(user);
  });
  mock.method(clerkClient.users, "unlockUser", async (id: string) => {
    calls.unlocked.push(id);
    users.get(id)!.locked = false;
    return asClerkUser(users.get(id)!);
  });
  mock.method(clerkClient.sessions, "getSession", async (id: string) => ({
    id,
    userId: id === "sess_mismatch-admin" ? "different-account" : id.replace(/^sess_/, ""),
    status: id === "sess_inactive-admin" ? "ended" : "active",
  }) as never);
  mock.method(clerkClient.sessions, "getSessionList", async ({ userId }: { userId?: string }) => ({
    data: [{ id: `old_${userId}`, userId, status: "active" }],
    totalCount: 1,
  }) as never);
  mock.method(clerkClient.sessions, "revokeSession", async (id: string) => {
    calls.revoked.push(id);
    calls.events.push(`revoke:${id.replace(/^old_/, "")}`);
    return { id, status: "revoked" } as never;
  });
  mock.method(clerkClient.users, "deleteUser", async (id: string) => {
    calls.events.push(`delete-identity:${id}`);
    if (failDeleteUser) throw { clerkError: true, errors: [{ code: "api_error" }] };
    calls.deleted.push(id);
    users.delete(id);
    return { id, deleted: true } as never;
  });
  mock.method(db, "update", (table: unknown) => ({
    set: () => ({
      where: async () => {
        assert.equal(table, liveTripsTable);
        calls.events.push("retire:delete-driver");
        if (failRetire) throw new Error("database unavailable");
      },
    }),
  }) as never);
  mock.method(db, "delete", (table: unknown) => ({
    where: async () => {
      assert.equal(table, driverProfilesTable);
      calls.events.push("delete-profile:delete-driver");
    },
  }) as never);
  mock.method(db, "select", () => ({
    from: () => ({
      where: async () => [
        { clerkSubject: "driver", unitNumber: "U-17", displayName: "Saved Profile Name" },
      ],
    }),
  }) as never);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = typeof req.headers["x-test-user"] === "string" ? req.headers["x-test-user"] : null;
    Object.assign(req, {
      auth: Object.assign(() => ({
        userId,
        sessionId: userId ? `sess_${userId}` : null,
        tokenType: "session_token",
        sessionClaims: { role: "admin" },
      }), { [Symbol.for("@clerk/express.auth")]: true }),
      log: { info() {}, warn() {}, error() {} },
    });
    next();
  });
  app.use("/api", adminDriversRouter);
  app.use("/api", adminStopsRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
      resolve();
    });
  });
});

after(async () => {
  mock.restoreAll();
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test("admin access returns stable denial reasons and accepts only a current strict admin", async () => {
  const cases = [
    [undefined, 401, "AUTH_REQUIRED"],
    ["not-admin", 403, "ADMIN_ACCESS_REQUIRED"],
    ["banned-admin", 403, "ACCOUNT_RESTRICTED"],
    ["locked-admin", 403, "ACCOUNT_RESTRICTED"],
    ["inactive-admin", 401, "ADMIN_SESSION_INVALID"],
    ["mismatch-admin", 401, "ADMIN_SESSION_INVALID"],
  ] as const;
  for (const [user, status, code] of cases) {
    const denied = await request("/admin/access", user ? { user } : {});
    assert.equal(denied.status, status);
    assert.equal((await denied.json() as { code: string }).code, code);
  }

  const response = await request("/admin/access", { user: "admin" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    authorized: true,
    role: "admin",
    capabilities: ["dispatch", "content", "identity", "roles", "history"],
  });
  const untrusted = await request("/admin/access", {
    user: "admin",
    headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  });
  assert.equal(untrusted.status, 403);
  assert.equal((await untrusted.json() as { code: string }).code, "UNTRUSTED_ORIGIN");
});

test("role policy allows scoped access but blocks credential and cross-scope actions", async () => {
  const dispatcherAccess = await request("/admin/access", { user: "dispatcher" });
  assert.equal(dispatcherAccess.status, 200);
  assert.equal((await dispatcherAccess.json() as { role: string }).role, "dispatcher");
  assert.equal((await request("/admin/drivers", { user: "dispatcher" })).status, 403);
  assert.equal((await request("/admin/coaches", {
    user: "dispatcher",
    method: "POST",
    body: { busNumber: "INVALID!" },
  })).status, 400);

  const contentAccess = await request("/admin/access", { user: "content" });
  assert.equal(contentAccess.status, 200);
  assert.equal((await contentAccess.json() as { role: string }).role, "content");
  assert.equal((await request("/admin/drivers", { user: "content" })).status, 403);
  assert.equal((await request("/admin/coaches", {
    user: "content",
    method: "POST",
    body: { busNumber: "INVALID!" },
  })).status, 403);
  assert.equal((await request("/admin/address-search?q=x", { user: "content" })).status, 400);
  assert.equal((await request("/admin/address-search?q=x", { user: "dispatcher" })).status, 403);
});

test("name resolution preserves saved, legacy, partial, and genuinely missing names", () => {
  const unnamed = asClerkUser({
    id: "unnamed",
    username: "unnamed",
    banned: false,
    locked: false,
    privateMetadata: {},
  });
  assert.deepEqual(resolveDriverName(unnamed), {
    displayName: null,
    firstName: null,
    lastName: null,
  });
  assert.deepEqual(resolveDriverName(users.get("driver") as never, { displayName: "Saved Name" }), {
    displayName: "Saved Name",
    firstName: null,
    lastName: null,
  });
  assert.deepEqual(resolveDriverName(asClerkUser({
    id: "standard-name",
    username: "standard-name",
    firstName: "Clerk",
    lastName: "Fallback",
    banned: false,
    locked: false,
    privateMetadata: {},
  })), {
    displayName: "Clerk Fallback",
    firstName: "Clerk",
    lastName: "Fallback",
  });
  assert.deepEqual(resolveDriverName(users.get("flag-driver") as never), {
    displayName: "Legacy Driver",
    firstName: null,
    lastName: null,
  });
  assert.deepEqual(resolveDriverName(users.get("delete-driver") as never), {
    displayName: "Partial",
    firstName: null,
    lastName: "Partial",
  });
});

test("listing scans Clerk pages and returns only non-admin drivers", async () => {
  const response = await request("/admin/drivers?offset=0", { user: "admin" });
  assert.equal(response.status, 200);
  const body = await response.json() as { drivers: Array<Record<string, unknown>>; nextOffset: number | null };
  assert.deepEqual(body.drivers.map(driver => driver.id), ["driver", "flag-driver", "delete-driver"]);
  assert.equal(body.nextOffset, null);
  assert.deepEqual(body.drivers[0], {
    id: "driver",
    username: "driver-one",
    displayName: "Saved Profile Name",
    firstName: null,
    lastName: null,
    unitNumber: "U-17",
    disabled: false,
  });
  assert.deepEqual(body.drivers[1], {
    id: "flag-driver",
    username: "driver-two",
    displayName: "Legacy Driver",
    firstName: null,
    lastName: null,
    unitNumber: null,
    disabled: false,
  });
  assert.deepEqual(body.drivers[2], {
    id: "delete-driver",
    username: "driver-delete",
    displayName: "Partial",
    firstName: null,
    lastName: "Partial",
    unitNumber: null,
    disabled: false,
  });
  assert.equal((await request("/admin/drivers?offset=-1", { user: "admin" })).status, 400);
});

test("creation validates input and sends credentials only to Clerk", async () => {
  assert.equal((await request("/admin/drivers", {
    user: "admin", method: "POST", body: { username: "x", password: "short" },
  })).status, 400);
  const response = await request("/admin/drivers", {
    user: "admin",
    method: "POST",
    body: {
      firstName: "New",
      lastName: "Driver",
      username: "new.driver",
      password: "Valid-pass-123",
      email: "driver@example.com",
    },
  });
  assert.equal(response.status, 201);
  assert.deepEqual(calls.created.at(-1), {
    firstName: "New",
    lastName: "Driver",
    username: "new.driver",
    password: "Valid-pass-123",
    emailAddress: ["driver@example.com"],
    privateMetadata: { role: "driver", driverAccess: true },
  });
  const encoded = JSON.stringify(await response.json());
  assert.ok(!encoded.includes("Valid-pass-123"));
  assert.ok(!encoded.includes("driver@example.com"));
});

test("creation sanitizes Clerk identifier, password, and configuration errors", async () => {
  for (const [clerkCode, status, responseCode] of [
    ["form_identifier_exists", 409, "DRIVER_IDENTIFIER_EXISTS"],
    ["form_password_pwned", 400, "INVALID_DRIVER_PASSWORD"],
    ["form_param_missing", 422, "CLERK_CONFIGURATION_REQUIRED"],
  ] as const) {
    createFailure = {
      clerkError: true,
      errors: [{ code: clerkCode, message: "raw provider detail", longMessage: "secret raw body" }],
    };
    const response = await request("/admin/drivers", {
      user: "admin",
      method: "POST",
      body: { username: "new.driver", password: "Valid-pass-123" },
    });
    assert.equal(response.status, status);
    const encoded = JSON.stringify(await response.json());
    assert.ok(encoded.includes(responseCode));
    assert.ok(!encoded.includes("raw provider detail"));
    assert.ok(!encoded.includes("secret raw body"));
  }
  createFailure = null;
});

test("creation gives safe field-specific messages for provider-required names", async () => {
  for (const [paramName, message] of [
    ["first_name", "First name is required by the current identity provider configuration."],
    ["last_name", "Last name is required by the current identity provider configuration."],
  ] as const) {
    createFailure = {
      clerkError: true,
      errors: [{
        code: "form_data_missing",
        message: "raw provider detail",
        meta: { param_name: paramName },
      }],
    };
    const response = await request("/admin/drivers", {
      user: "admin",
      method: "POST",
      body: { username: "new.driver", password: "Valid-pass-123" },
    });
    assert.equal(response.status, 422);
    const body = await response.json() as { code: string; error: string };
    assert.equal(body.code, "CLERK_CONFIGURATION_REQUIRED");
    assert.equal(body.error, message);
    assert.ok(!JSON.stringify(body).includes("raw provider detail"));
  }

  createFailure = {
    clerkError: true,
    errors: [{ code: "form_data_missing", message: "raw provider detail" }],
  };
  const response = await request("/admin/drivers", {
    user: "admin",
    method: "POST",
    body: { username: "new.driver", password: "Valid-pass-123" },
  });
  assert.equal(response.status, 422);
  assert.match((await response.json() as { error: string }).error, /first and last names/i);
  createFailure = null;
});

test("creation clearly reports email disabled by the provider", async () => {
  createFailure = {
    clerkError: true,
    errors: [{
      code: "form_data_not_allowed",
      message: "raw provider detail",
      meta: { paramName: "email_address" },
    }],
  };
  const response = await request("/admin/drivers", {
    user: "admin",
    method: "POST",
    body: {
      username: "new.driver",
      password: "Valid-pass-123",
      email: "driver@example.com",
    },
  });
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error: "Email cannot be used because it is disabled by the current identity provider configuration.",
    code: "CLERK_EMAIL_NOT_ALLOWED",
  });
  createFailure = null;
});

test("disable rejects self, admins, and unrelated accounts", async () => {
  for (const id of ["admin", "not-admin", "other"]) {
    assert.equal((await request(`/admin/drivers/${id}/disable`, { user: "admin", method: "POST" })).status, 403);
  }
  const response = await request("/admin/drivers/driver/disable", { user: "admin", method: "POST" });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.banned, ["driver"]);
  assert.equal((await response.json() as { driver: { disabled: boolean } }).driver.disabled, true);
});

test("reset changes the password, restores disabled drivers, and revokes sessions", async () => {
  const driver = users.get("driver")!;
  driver.banned = true;
  driver.locked = true;
  const response = await request("/admin/drivers/driver/reset-access", {
    user: "admin", method: "POST", body: { password: "Replacement-123" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.updated.at(-1), {
    id: "driver",
    input: { password: "Replacement-123", signOutOfOtherSessions: true },
  });
  assert.equal(calls.unbanned.at(-1), "driver");
  assert.equal(calls.unlocked.at(-1), "driver");
  assert.equal(calls.revoked.at(-1), "old_driver");
  assert.equal((await response.json() as { driver: { disabled: boolean } }).driver.disabled, false);
});

test("reset explicitly reports partial failure after password mutation", async () => {
  users.get("driver")!.banned = true;
  failUnban = true;
  const response = await request("/admin/drivers/driver/reset-access", {
    user: "admin", method: "POST", body: { password: "Replacement-456" },
  });
  assert.equal(response.status, 502);
  const body = await response.json() as { code: string; error: string };
  assert.equal(body.code, "RESET_PARTIAL_FAILURE");
  assert.match(body.error, /password was changed/i);
  failUnban = false;
});

test("enable requires auth, rejects invalid targets, and restores access without changing password", async () => {
  assert.equal((await request("/admin/drivers/driver/enable", { method: "POST" })).status, 401);
  assert.equal((await request("/admin/drivers/missing/enable", { user: "admin", method: "POST" })).status, 404);
  for (const id of ["admin", "not-admin", "other"]) {
    assert.equal((await request(`/admin/drivers/${id}/enable`, { user: "admin", method: "POST" })).status, 403);
  }

  const driver = users.get("driver")!;
  driver.banned = true;
  driver.locked = true;
  const updatesBefore = calls.updated.length;
  const response = await request("/admin/drivers/driver/enable", { user: "admin", method: "POST" });
  assert.equal(response.status, 200);
  assert.equal(calls.unlocked.at(-1), "driver");
  assert.equal(calls.unbanned.at(-1), "driver");
  assert.equal(calls.updated.length, updatesBefore);
  assert.equal((await response.json() as { driver: { disabled: boolean } }).driver.disabled, false);
});

test("enable explicitly reports a partial failure after starting restoration", async () => {
  users.get("driver")!.banned = true;
  failUnban = true;
  const response = await request("/admin/drivers/driver/enable", { user: "admin", method: "POST" });
  assert.equal(response.status, 502);
  assert.equal((await response.json() as { code: string }).code, "ENABLE_PARTIAL_FAILURE");
  assert.equal(users.get("driver")!.banned, true);
  failUnban = false;
});

test("delete requires auth and rejects missing, self, admin, and non-driver targets", async () => {
  assert.equal((await request("/admin/drivers/delete-driver", { method: "DELETE" })).status, 401);
  assert.equal((await request("/admin/drivers/missing", { user: "admin", method: "DELETE" })).status, 404);
  for (const id of ["admin", "not-admin", "other"]) {
    assert.equal((await request(`/admin/drivers/${id}`, { user: "admin", method: "DELETE" })).status, 403);
  }
});

test("delete disables identity before retiring owned coaches, removing profile, and deleting identity", async () => {
  const start = calls.events.length;
  const response = await request("/admin/drivers/delete-driver", { user: "admin", method: "DELETE" });
  assert.equal(response.status, 204);
  assert.deepEqual(calls.events.slice(start), [
    "ban:delete-driver",
    "revoke:delete-driver",
    "retire:delete-driver",
    "delete-profile:delete-driver",
    "delete-identity:delete-driver",
  ]);
  assert.deepEqual(calls.deleted, ["delete-driver"]);
});

test("delete reports partial failure while leaving the identity disabled and retryable", async () => {
  const retryDriver: TestUser = {
    id: "delete-driver",
    username: "driver-delete",
    banned: false,
    locked: false,
    privateMetadata: { role: "driver", driverAccess: true },
  };
  users.set(retryDriver.id, retryDriver);
  failRetire = true;
  const response = await request("/admin/drivers/delete-driver", { user: "admin", method: "DELETE" });
  assert.equal(response.status, 502);
  assert.equal((await response.json() as { code: string }).code, "DELETE_PARTIAL_FAILURE");
  assert.equal(retryDriver.banned, true);
  assert.equal(calls.deleted.includes("delete-driver"), true);
  failRetire = false;

  failDeleteUser = true;
  const identityFailure = await request("/admin/drivers/delete-driver", { user: "admin", method: "DELETE" });
  assert.equal(identityFailure.status, 502);
  assert.equal((await identityFailure.json() as { code: string }).code, "DELETE_PARTIAL_FAILURE");
  assert.equal(retryDriver.banned, true);
  failDeleteUser = false;
});