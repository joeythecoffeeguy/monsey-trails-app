import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const worker = readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf8');

type WorkerEvent = {
  request?: { method: string; mode: string; url: string };
  waitUntil: (promise: Promise<unknown>) => void;
  respondWith: (promise: Promise<unknown>) => void;
};

function createWorkerHarness(fetchImplementation: (request: unknown) => Promise<unknown>) {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const stores = new Map<string, Map<string, unknown>>();
  const cachePut = vi.fn(async function (this: Map<string, unknown>, key: unknown, value: unknown) {
    this.set(typeof key === 'string' ? key : (key as { url: string }).url, value);
  });
  const caches = {
    open: vi.fn(async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        put: cachePut.bind(store),
        match: vi.fn(async (key: unknown) => (
          store.get(typeof key === 'string' ? key : (key as { url: string }).url)
        )),
      };
    }),
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async (name: string) => stores.delete(name)),
  };
  const self = {
    registration: {
      scope: 'https://coach.test/passengers/',
      showNotification: vi.fn(),
    },
    clients: {
      claim: vi.fn(),
      matchAll: vi.fn(),
      openWindow: vi.fn(),
    },
    skipWaiting: vi.fn(),
    addEventListener: (name: string, listener: (event: WorkerEvent) => void) => {
      listeners.set(name, listener);
    },
  };

  vm.runInNewContext(worker, {
    self,
    caches,
    fetch: vi.fn(fetchImplementation),
    URL,
    Response: { error: vi.fn(() => ({ error: true })) },
    Set,
    Error,
    Promise,
  });

  const dispatch = async (name: string, request?: WorkerEvent['request']) => {
    let pending: Promise<unknown> | undefined;
    let response: Promise<unknown> | undefined;
    listeners.get(name)!({
      request,
      waitUntil: (promise) => { pending = promise; },
      respondWith: (promise) => { response = promise; },
    });
    return {
      pending,
      response,
      wait: () => pending,
      result: () => response,
    };
  };

  return { caches, dispatch, stores, fetch: fetchImplementation };
}

function response(body: string, ok = true) {
  return {
    ok,
    type: 'basic',
    clone() { return response(body, ok); },
    text: async () => body,
  };
}

describe('personal passenger service worker boundaries', () => {
  it('preloads the built passenger shell and its discovered hashed assets', () => {
    expect(worker).toContain("const passengerPath = `${scopePath}passengers`");
    expect(worker).toContain('shellAssetUrls(html)');
    expect(worker).toContain("/^assets\\/[^/]+\\.(?:js|css)$/");
    expect(worker).toContain('cache.put(passengerShellUrl');
  });

  it('never supplies navigation fallback or caches for private and API routes', () => {
    expect(worker).toContain('if (!isPassengerNavigation(url)) return');
    expect(worker).toContain("url.pathname.startsWith('/api/')");
    expect(worker).not.toMatch(/cache\.put\(event\.request/);
    expect(worker).not.toContain('caches.match(');
    expect(worker).not.toContain("'/drivers'");
    expect(worker).not.toContain("'/admin");
    expect(worker).not.toContain("'/sign-in");
  });

  it('does not rewrite the immutable shell cache during online navigation', async () => {
    const networkResponse = response('online');
    const fetchMock = vi.fn(async () => networkResponse);
    const harness = createWorkerHarness(fetchMock);

    const event = await harness.dispatch('fetch', {
      method: 'GET',
      mode: 'navigate',
      url: 'https://coach.test/passengers/passengers',
    });

    await expect(event.result()).resolves.toBe(networkResponse);
    expect(harness.caches.open).not.toHaveBeenCalled();
  });

  it('deletes a partial new cache and rejects install when a required asset fails', async () => {
    const shell = response(`
      <script src="/passengers/assets/app.js"></script>
      <link rel="stylesheet" href="/passengers/assets/app.css">
      <a href="/passengers/private-document">Private</a>
    `);
    const requested: string[] = [];
    const harness = createWorkerHarness(async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith('/assets/app.css')) return response('', false);
      return url.endsWith('/passengers') ? shell : response('asset');
    });
    harness.stores.set('monsey-passenger-shell-previous', new Map([
      ['https://coach.test/passengers/passengers', response('old shell')],
    ]));

    const event = await harness.dispatch('install');
    await expect(event.wait()).rejects.toThrow('Passenger shell precache failed');
    expect(harness.caches.delete).toHaveBeenCalledWith(
      'monsey-passenger-shell-__PASSENGER_CACHE_VERSION__',
    );
    expect(requested).not.toContain('https://coach.test/passengers/private-document');
    expect(harness.stores.has('monsey-passenger-shell-previous')).toBe(true);
    expect(harness.stores.has('monsey-passenger-shell-__PASSENGER_CACHE_VERSION__')).toBe(false);
  });
});