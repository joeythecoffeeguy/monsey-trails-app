const EXACT_PUSH_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
  "push.apple.com",
]);

export function isSupportedPushEndpoint(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const endpoint = new URL(value);
    const hostname = endpoint.hostname.toLowerCase();
    return endpoint.protocol === "https:"
      && !endpoint.username
      && !endpoint.password
      && (!endpoint.port || endpoint.port === "443")
      && (EXACT_PUSH_HOSTS.has(hostname)
        || hostname === "notify.windows.com"
        || hostname.endsWith(".notify.windows.com"));
  } catch {
    return false;
  }
}