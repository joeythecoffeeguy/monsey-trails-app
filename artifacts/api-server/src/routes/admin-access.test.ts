import assert from "node:assert/strict";
import test from "node:test";
import { changeAdminRoleSafely } from "./admin-access";
import { safeAuditValue } from "../middlewares/admin-role-policy";

test("simultaneous demotions serialize and preserve one full administrator", async () => {
  const users = new Map([
    ["admin-a", {
      id: "admin-a", username: "a", firstName: "A", lastName: null,
      banned: false, locked: false, privateMetadata: { role: "admin" },
    }],
    ["admin-b", {
      id: "admin-b", username: "b", firstName: "B", lastName: null,
      banned: false, locked: false, privateMetadata: { role: "admin" },
    }],
  ]);
  let tail = Promise.resolve();
  const dependencies = {
    withLock<T>(work: () => Promise<T>) {
      const result = tail.then(work);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
    listUsers: async () => [...users.values()] as never,
    updateMetadata: async (id: string, privateMetadata: Record<string, unknown>) => {
      await new Promise(resolve => setTimeout(resolve, 5));
      const user = users.get(id)!;
      user.privateMetadata = privateMetadata as { role: string };
      return user as never;
    },
    revokeSessions: async () => undefined,
  };

  const outcomes = await Promise.allSettled([
    changeAdminRoleSafely("admin-a", "dispatcher", dependencies),
    changeAdminRoleSafely("admin-b", "dispatcher", dependencies),
  ]);

  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  const rejection = outcomes.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejection.reason.code, "LAST_ADMIN_REQUIRED");
  assert.equal([...users.values()].filter(user => user.privateMetadata.role === "admin").length, 1);
});

test("audit snapshots preserve bounded nested context while redacting secrets", () => {
  const snapshot = safeAuditValue({
    roleChange: {
      from: "admin",
      to: "dispatcher",
      sessionToken: "must-not-leak",
      nested: { reason: "coverage" },
    },
    password: "must-not-leak",
    list: Array.from({ length: 25 }, (_, index) => ({ index })),
  })!;

  assert.deepEqual(snapshot.roleChange, {
    from: "admin",
    to: "dispatcher",
    sessionToken: "[REDACTED]",
    nested: { reason: "coverage" },
  });
  assert.equal(snapshot.password, "[REDACTED]");
  assert.equal((snapshot.list as unknown[]).length, 21);
  assert.equal(JSON.stringify(snapshot).includes("must-not-leak"), false);
});