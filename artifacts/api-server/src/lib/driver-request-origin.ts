import type { Request } from "express";

type OriginRequest = Pick<Request, "headers" | "socket" | "protocol" | "method">;

function singleHeader(value: string | string[] | undefined) {
  return typeof value === "string" && !value.includes(",") ? value.trim() : "";
}

function parsedOrigin(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.origin === value ? url : null;
  } catch { return null; }
}

function loopbackPeer(address: string | undefined) {
  return address === "::1" || Boolean(address && /^(?:::ffff:)?127\.\d+\.\d+\.\d+$/.test(address));
}

// Explicit application origins and Replit's runtime domain list are configuration,
// not credentials. Never trust arbitrary client-supplied X-Forwarded-Host values.
export function configuredDriverOrigins() {
  return [
    ...(process.env.DRIVER_ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()),
    ...(process.env.REPLIT_DOMAINS ?? "").split(",").map(value => value.trim()).filter(Boolean)
      .map(host => `https://${host}`),
  ].filter(value => parsedOrigin(value));
}

export function isTrustedDriverRequest(req: OriginRequest, allowedOrigins = configuredDriverOrigins()) {
  const site = singleHeader(req.headers["sec-fetch-site"]);
  // same-site is not same-origin: a sibling subdomain must not mutate driver state.
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = singleHeader(req.headers.origin);
  if (!origin) {
    if (req.headers.origin !== undefined) return false;
    // Non-browser/native calls still pass through Clerk authentication. Browser
    // metadata is accepted only for same-origin requests or safe navigations.
    return !site || site === "same-origin" || ["GET", "HEAD", "OPTIONS"].includes(req.method);
  }
  const parsed = parsedOrigin(origin);
  if (!parsed) return false;
  const allowed = new Set(allowedOrigins.filter(value => parsedOrigin(value)));
  if (allowed.has(origin)) return true;

  const trustedProxy = loopbackPeer(req.socket.remoteAddress);
  const forwardedProtocol = singleHeader(req.headers["x-forwarded-proto"]);
  const protocol = trustedProxy && ["http", "https"].includes(forwardedProtocol)
    ? forwardedProtocol : req.protocol;
  const host = singleHeader(req.headers.host);
  if (host && origin === `${protocol}://${host}`) return true;

  // Forwarded hosts are usable only from the local gateway AND when explicitly
  // configured. Otherwise an untrusted forwarded header could forge the origin.
  const forwardedHost = trustedProxy ? singleHeader(req.headers["x-forwarded-host"]) : "";
  return Boolean(forwardedHost && origin === `${protocol}://${forwardedHost}` && allowed.has(origin));
}