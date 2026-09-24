const CACHE_NAME = 'monsey-passenger-shell-__PASSENGER_CACHE_VERSION__';
const scopeUrl = new URL(self.registration.scope);
const scopePath = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`;
const passengerPath = `${scopePath}passengers`.replace(/\/{2,}/g, '/');
const passengerShellUrl = new URL(passengerPath, scopeUrl.origin).href;
const requiredStaticAssetPaths = new Set([
  `${scopePath}favicon.svg`,
  `${scopePath}monsey-trails-logo.png`,
  `${scopePath}manifest.json`,
]);

function isPassengerNavigation(url) {
  const normalized = url.pathname.replace(/\/+$/, '') || '/';
  return normalized === passengerPath.replace(/\/+$/, '');
}

function shellAssetUrls(html) {
  const urls = new Set([...requiredStaticAssetPaths].map((pathname) => (
    new URL(pathname, scopeUrl.origin).href
  )));
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const url = new URL(match[1], passengerShellUrl);
    const builtAssetPath = url.pathname.slice(scopePath.length);
    if (
      url.origin === scopeUrl.origin
      && url.pathname.startsWith(scopePath)
      && /^assets\/[^/]+\.(?:js|css)$/.test(builtAssetPath)
    ) {
      urls.add(url.href);
    }
  }
  return [...urls];
}

function requireCacheable(response, url) {
  if (!response?.ok || response.type === 'opaque') {
    throw new Error(`Passenger shell precache failed: ${url}`);
  }
  return response;
}

async function installPassengerShell() {
  try {
    const shell = requireCacheable(
      await fetch(passengerShellUrl, { cache: 'reload' }),
      passengerShellUrl,
    );
    const html = await shell.clone().text();
    const assets = await Promise.all(shellAssetUrls(html).map(async (url) => [
      url,
      requireCacheable(await fetch(url, { cache: 'reload' }), url),
    ]));

    const cache = await caches.open(CACHE_NAME);
    await cache.put(passengerShellUrl, shell);
    await Promise.all(assets.map(([url, response]) => cache.put(url, response)));
  } catch (error) {
    // A failed update must never leave a cache that activation could mistake for
    // a complete shell. The previous active worker's cache has a different name.
    await caches.delete(CACHE_NAME);
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await installPassengerShell();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => (
      key !== CACHE_NAME
      && (key.startsWith('monsey-passenger-shell-') || key.startsWith('coach-passenger-shell-'))
    )).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (
    url.origin !== scopeUrl.origin
    || url.pathname.startsWith('/api/')
    || url.pathname.startsWith(`${scopePath}api/`)
  ) return;

  if (event.request.mode === 'navigate') {
    // Driver, administrator, authentication, and mounted-display documents are
    // always network-only. This worker only owns the public personal passenger shell.
    if (!isPassengerNavigation(url)) return;
    event.respondWith((async () => {
      try {
        return await fetch(event.request);
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(passengerShellUrl)) || Response.error();
      }
    })());
    return;
  }

  // Only serve assets explicitly discovered while precaching the passenger shell.
  // Never grow the cache from driver/admin/auth requests.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request, { ignoreSearch: false });
    return cached || fetch(event.request);
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(self.registration.showNotification(data.title || 'Coach update', {
    body: data.body || 'Your selected stop is approaching.',
    icon: new URL('monsey-trails-logo.png', scopeUrl).href,
    badge: new URL('favicon.svg', scopeUrl).href,
    tag: data.tag || 'coach-stop-alert',
    renotify: true,
    requireInteraction: true,
    data: { url: data.url || passengerShellUrl },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || passengerShellUrl, scopeUrl.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(scopeUrl.origin));
      return existing ? existing.focus() : self.clients.openWindow(target);
    }),
  );
});