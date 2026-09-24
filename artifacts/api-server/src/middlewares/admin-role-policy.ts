import { randomUUID } from "node:crypto";
import { clerkClient, getAuth } from "@clerk/express";
import type { Request, RequestHandler } from "express";
import { adminActionHistoryTable, db } from "@workspace/db";
import { isTrustedDriverRequest } from "../lib/driver-request-origin";

export const ADMIN_ROLES = ["admin", "dispatcher", "content"] as const;
export type AdminRole = typeof ADMIN_ROLES[number];
export type AdminCapability = "access" | "dispatch" | "content" | "identity" | "roles" | "history";

const ROLE_CAPABILITIES: Record<AdminRole, ReadonlySet<AdminCapability>> = {
  admin: new Set(["access", "dispatch", "content", "identity", "roles", "history"]),
  dispatcher: new Set(["access", "dispatch"]),
  content: new Set(["access", "content"]),
};

export function adminRoleHasAnyCapability(role: AdminRole, required: readonly AdminCapability[]) {
  return required.some(capability => ROLE_CAPABILITIES[role].has(capability));
}

function roleFrom(value: unknown): AdminRole | null {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value)
    ? value as AdminRole
    : null;
}

export function capabilityForAdminRequest(req: Pick<Request, "path" | "originalUrl">): AdminCapability | null {
  const originalPath = req.originalUrl.split("?")[0].replace(/^\/api(?=\/)/, "");
  const path = originalPath.startsWith("/admin") ? originalPath : req.path;
  if (path === "/admin/access") return "access";
  if (path.startsWith("/admin/roles")) return "roles";
  if (path.startsWith("/admin/history")) return "history";
  if (path.startsWith("/admin/drivers")) return "identity";
  if (
    path.startsWith("/admin/schedule-stops")
    || path.startsWith("/admin/scheduled-stop-changes")
    || path.startsWith("/admin/address-search")
    || path.startsWith("/admin/display")
    || path.startsWith("/admin/passenger-communications")
  ) return "content";
  if (
    path.startsWith("/admin/active-trips")
    || path.startsWith("/admin/dispatch-assignments")
    || path.startsWith("/admin/coaches")
    || path.startsWith("/admin/service-disruptions")
    || path.startsWith("/admin/operations")
    || path.startsWith("/admin/communications")
    || path.startsWith("/admin/dispatch-instructions")
    || path.startsWith("/admin/operational-reports")
    || path.startsWith("/admin/incidents")
    || path.startsWith("/admin/notifications")
  ) return "dispatch";
  return null;
}

function deny(req: Request, status: 401 | 403 | 503, code: string, error: string) {
  req.log.warn({ reasonCode: code, requestId: req.id }, "Administrator access check denied");
  return { status, body: { error, code } };
}

function normalizedAction(req: Request, capability: AdminCapability) {
  const staticSegments = new Set([
    "active-trips", "disconnect-screens", "start", "stop", "dispatch-assignments",
    "coaches", "service-disruptions", "communications", "dispatch-instructions",
    "operational-reports", "resolve", "schedule-stops", "drivers", "disable",
    "enable", "reset-access", "roles",
  ]);
  const path = req.originalUrl.split("?")[0].replace(/^\/api(?=\/)/, "");
  const suffix = path.replace(/^\/admin\/?/, "").split("/").filter(Boolean)
    .map(part => staticSegments.has(part) ? part : ":target")
    .join(".");
  return `${req.method.toLowerCase()}.${suffix || capability}`.slice(0, 120);
}

const auditHealth = {
  consecutiveFailures: 0,
  lastFailureAt: null as string | null,
  lastSuccessAt: null as string | null,
};

export function getAdminAuditHealth() {
  return {
    status: auditHealth.consecutiveFailures > 0
      ? "degraded" as const
      : auditHealth.lastSuccessAt
        ? "healthy" as const
        : "unknown" as const,
    ...auditHealth,
  };
}

function safeAuditNode(value: unknown, depth: number): unknown {
  if (value === null || ["number", "boolean"].includes(typeof value)) return value;
  if (typeof value === "string") return value.slice(0, 240);
  if (depth >= 4) return "[MAX_DEPTH]";
  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map(item => safeAuditNode(item, depth + 1));
    if (value.length > 20) items.push("[TRUNCATED]");
    return items;
  }
  if (!value || typeof value !== "object") return String(value).slice(0, 80);
  const blocked = /password|secret|token|authorization|cookie|pairing|device|endpoint|session|credential|private.?key/i;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key))
    .slice(0, 30)
    .map(([key, item]) => [
      key,
      blocked.test(key) ? "[REDACTED]" : safeAuditNode(item, depth + 1),
    ]);
  const result = Object.fromEntries(entries);
  if (Object.keys(value as object).length > 30) result.$truncated = true;
  return result;
}

export function safeAuditValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return safeAuditNode(value, 0) as Record<string, unknown>;
}

function installMutationAudit(req: Request, res: Parameters<RequestHandler>[1], capability: AdminCapability) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return;
  const path = req.originalUrl.split("?")[0];
  if (/\/notifications\/device(?:\/|$)|\/pairing(?:\/|$)|\/devices?(?:\/|$)/i.test(path)) return;
  res.once("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 400) return;
    const details = res.locals.adminAudit as {
      action?: string;
      targetType?: string;
      targetId?: string;
      before?: unknown;
      after?: unknown;
    } | undefined;
    void db.insert(adminActionHistoryTable).values({
      id: randomUUID(),
      actorSubject: String(res.locals.adminSubject),
      actorRole: String(res.locals.adminRole),
      capability,
      action: details?.action?.slice(0, 120) || normalizedAction(req, capability),
      targetType: details?.targetType?.slice(0, 48) ?? null,
      targetId: details?.targetId?.slice(0, 240) ?? null,
      before: safeAuditValue(details?.before),
      after: safeAuditValue(details?.after),
    }).then(() => {
      auditHealth.consecutiveFailures = 0;
      auditHealth.lastSuccessAt = new Date().toISOString();
    }).catch(error => {
      auditHealth.consecutiveFailures += 1;
      auditHealth.lastFailureAt = new Date().toISOString();
      req.log.error({ err: error, action: "record_admin_history" }, "Administrator history write failed");
    });
  });
}

export function requireAnyAdminCapability(requiredCapabilities: readonly AdminCapability[]): RequestHandler {
  return async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const alreadyVerifiedRole = roleFrom(res.locals.adminRole);
    if (
      res.locals.adminSubject
      && alreadyVerifiedRole
      && adminRoleHasAnyCapability(alreadyVerifiedRole, requiredCapabilities)
    ) {
      next();
      return;
    }
    const auth = getAuth(req);
    if (!auth.userId || !auth.sessionId) {
      const denied = deny(req, 401, "AUTH_REQUIRED", "Administrator sign-in is required.");
      res.status(denied.status).json(denied.body);
      return;
    }
    if (!isTrustedDriverRequest(req)) {
      const denied = deny(req, 403, "UNTRUSTED_ORIGIN", "Administrator requests must come from this application's trusted origin.");
      res.status(denied.status).json(denied.body);
      return;
    }
    try {
      const [user, session] = await Promise.all([
        clerkClient.users.getUser(auth.userId),
        clerkClient.sessions.getSession(auth.sessionId),
      ]);
      if (user.banned || user.locked) {
        const denied = deny(req, 403, "ACCOUNT_RESTRICTED", "This account is restricted and cannot access administrator tools.");
        res.status(denied.status).json(denied.body);
        return;
      }
      if (session.status !== "active" || session.userId !== auth.userId) {
        const denied = deny(req, 401, "ADMIN_SESSION_INVALID", "The administrator session has expired or no longer matches this account.");
        res.status(denied.status).json(denied.body);
        return;
      }
      const role = roleFrom((user.privateMetadata as { role?: unknown }).role);
      if (!role) {
        const denied = deny(req, 403, "ADMIN_ACCESS_REQUIRED", "Administrator access is required.");
        res.status(denied.status).json(denied.body);
        return;
      }
      const grantedCapability = requiredCapabilities.find(required => ROLE_CAPABILITIES[role].has(required));
      if (!grantedCapability) {
        const denied = deny(req, 403, "ADMIN_CAPABILITY_REQUIRED", "Your administrator role does not allow this action.");
        res.status(denied.status).json(denied.body);
        return;
      }
      res.locals.adminSubject = auth.userId;
      res.locals.adminRole = role;
      res.locals.adminCapability = grantedCapability;
      installMutationAudit(req, res, grantedCapability);
      next();
    } catch {
      const denied = deny(req, 503, "ADMIN_ACCESS_UNAVAILABLE", "Administrator access could not be verified. Please try again.");
      res.status(denied.status).json(denied.body);
    }
  };
}

export function requireAdminCapability(required: AdminCapability): RequestHandler {
  return requireAnyAdminCapability([required]);
}

export const requireAdmin: RequestHandler = (req, res, next) => {
  const capability = capabilityForAdminRequest(req);
  if (!capability) {
    res.set("Cache-Control", "no-store");
    res.status(403).json({
      error: "This administrator route has no configured role policy.",
      code: "ADMIN_POLICY_REQUIRED",
    });
    return;
  }
  requireAdminCapability(capability)(req, res, next);
};