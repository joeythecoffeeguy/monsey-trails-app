import { clerkClient } from "@clerk/express";
import { desc, sql } from "drizzle-orm";
import { json, Router, type IRouter } from "express";
import { adminActionHistoryTable, db } from "@workspace/db";
import {
  ADMIN_ROLES,
  getAdminAuditHealth,
  requireAdmin,
  type AdminRole,
} from "../middlewares/admin-role-policy";

const router: IRouter = Router();

router.use("/admin/roles", requireAdmin, json());
router.use("/admin/history", requireAdmin);

function clerkRole(user: { privateMetadata: unknown }): AdminRole | null {
  const role = (user.privateMetadata as { role?: unknown })?.role;
  return typeof role === "string" && (ADMIN_ROLES as readonly string[]).includes(role)
    ? role as AdminRole
    : null;
}

function publicRoleUser(user: {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  privateMetadata: unknown;
  banned: boolean;
  locked: boolean;
}) {
  return {
    id: user.id,
    username: user.username,
    displayName: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || user.id,
    role: clerkRole(user),
    restricted: Boolean(user.banned || user.locked),
  };
}

type RoleUser = Awaited<ReturnType<typeof clerkClient.users.getUserList>>["data"][number];
type RoleMutationResult = {
  updated: RoleUser;
  previousRole: AdminRole;
  changed: boolean;
};

async function roleUsers() {
  const users: Awaited<ReturnType<typeof clerkClient.users.getUserList>>["data"] = [];
  let offset = 0;
  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const page = await clerkClient.users.getUserList({ limit: 100, offset });
    users.push(...page.data);
    offset += page.data.length;
    if (!page.data.length || page.data.length < 100 || offset >= page.totalCount) return users;
  }
  throw Object.assign(new Error("The administrator directory is too large to verify safely."), {
    status: 503,
    code: "ADMIN_DIRECTORY_LIMIT",
  });
}

async function revokeActiveSessions(userId: string) {
  let offset = 0;
  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const page = await clerkClient.sessions.getSessionList({ userId, limit: 100, offset });
    await Promise.all(page.data
      .filter(session => session.status === "active")
      .map(session => clerkClient.sessions.revokeSession(session.id)));
    offset += page.data.length;
    if (!page.data.length || page.data.length < 100 || offset >= page.totalCount) return;
  }
  throw new Error("The account has too many sessions to revoke safely.");
}

type RoleMutationDependencies = {
  withLock: (work: () => Promise<RoleMutationResult>) => Promise<RoleMutationResult>;
  listUsers: () => Promise<RoleUser[]>;
  updateMetadata: (
    id: string,
    metadata: Record<string, unknown>,
  ) => Promise<RoleUser>;
  revokeSessions: (id: string) => Promise<void>;
};

const roleMutationDependencies: RoleMutationDependencies = {
  withLock: work => db.transaction(async tx => {
    // A transaction-scoped PostgreSQL advisory lock serializes role mutations
    // across every API process. Clerk is re-read only after acquiring it.
    await tx.execute(sql`set local lock_timeout = '10s'`);
    await tx.execute(sql`set local statement_timeout = '15s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(183510281, 10)`);
    return work();
  }),
  listUsers: roleUsers,
  updateMetadata: (id, privateMetadata) =>
    clerkClient.users.updateUserMetadata(id, { privateMetadata }) as Promise<RoleUser>,
  revokeSessions: revokeActiveSessions,
};

export async function changeAdminRoleSafely(
  targetId: string,
  nextRole: AdminRole,
  dependencies: RoleMutationDependencies = roleMutationDependencies,
): Promise<RoleMutationResult> {
  return dependencies.withLock(async () => {
    const users = await dependencies.listUsers();
    const target = users.find(user => user.id === targetId);
    if (!target || clerkRole(target) === null) {
      throw Object.assign(new Error("Administrator account not found."), {
        status: 404,
        code: "ADMIN_ACCOUNT_NOT_FOUND",
      });
    }
    const previousRole = clerkRole(target)!;
    if (previousRole === "admin" && nextRole !== "admin") {
      const activeAdmins = users.filter(user =>
        clerkRole(user) === "admin" && !user.banned && !user.locked);
      if (activeAdmins.length <= 1) {
        throw Object.assign(new Error("At least one unrestricted full administrator must remain."), {
          status: 409,
          code: "LAST_ADMIN_REQUIRED",
        });
      }
    }
    if (previousRole === nextRole) {
      return { updated: target, previousRole, changed: false };
    }
    const originalMetadata = target.privateMetadata as Record<string, unknown>;
    const updated = await dependencies.updateMetadata(target.id, {
      ...originalMetadata,
      role: nextRole,
    });
    try {
      await dependencies.revokeSessions(target.id);
    } catch (error) {
      await dependencies.updateMetadata(target.id, originalMetadata);
      throw Object.assign(
        new Error("The role change was rolled back because existing sessions could not be revoked.", { cause: error }),
        { status: 502, code: "ROLE_SESSION_REVOCATION_FAILED" },
      );
    }
    return { updated, previousRole, changed: true };
  });
}

router.get("/admin/roles", async (_req, res) => {
  const users = await roleUsers();
  res.json({
    users: users.filter(user => clerkRole(user) !== null).map(publicRoleUser),
  });
});

router.patch("/admin/roles/:id", async (req, res) => {
  const nextRole = typeof req.body?.role === "string" ? req.body.role : "";
  if (!(ADMIN_ROLES as readonly string[]).includes(nextRole)) {
    res.status(400).json({ error: "Role must be admin, dispatcher, or content.", code: "INVALID_ADMIN_ROLE" });
    return;
  }
  let result: RoleMutationResult;
  try {
    result = await changeAdminRoleSafely(req.params.id, nextRole as AdminRole);
  } catch (error) {
    const status = Number((error as { status?: number }).status) || 502;
    const code = (error as { code?: string }).code ?? "ROLE_CHANGE_FAILED";
    req.log.error({ err: error, targetSubject: req.params.id }, "Administrator role change failed");
    res.status(status).json({ error: error instanceof Error ? error.message : "The role could not be changed.", code });
    return;
  }
  if (!result.changed) {
    res.json(publicRoleUser(result.updated));
    return;
  }
  res.locals.adminAudit = {
    action: "change_admin_role",
    targetType: "admin_account",
    targetId: result.updated.id,
    before: { role: result.previousRole },
    after: { role: nextRole },
  };
  res.json(publicRoleUser(result.updated));
});

router.get("/admin/history", async (req, res) => {
  const requested = Number(req.query.limit);
  const limit = Number.isInteger(requested) ? Math.min(100, Math.max(1, requested)) : 50;
  const rows = await db.select().from(adminActionHistoryTable)
    .orderBy(desc(adminActionHistoryTable.createdAt))
    .limit(limit);
  res.json({
    health: getAdminAuditHealth(),
    actions: rows.map(row => ({
      id: row.id,
      actorSubject: row.actorSubject,
      actorRole: row.actorRole,
      capability: row.capability,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      before: row.before,
      after: row.after,
      createdAt: row.createdAt.toISOString(),
    })),
  });
});

export default router;