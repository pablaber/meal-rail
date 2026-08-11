// Minimal offline cache. Vite fingerprints asset filenames and emits a
// build-specific precache manifest so one completed online visit is enough to
// make the whole app shell available offline.
//
// This file is identical from one release to the next, so the page registers it
// as `sw.js?v=<build id>`: a fresh script URL each deploy is what makes the
// browser install a new worker at all.
//
// The cache name deliberately does not carry that version. A per-build cache
// would be empty for the whole session after an update — everything the reload
// fetched went into the outgoing build's cache — which is exactly when the app
// would be least able to open offline. One cache, added to across builds, is
// safe because the filenames are fingerprinted, and MAX_ENTRIES bounds it.
const CACHE = "meal-rail";
const MAX_ENTRIES = 12;

async function trim(cache, protectedUrls = new Set()) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_ENTRIES;
  if (excess <= 0) return;

  const removable = keys.filter((req) => !protectedUrls.has(req.url));
  await Promise.all(removable.slice(0, excess).map((req) => cache.delete(req)));
}

async function precache() {
  const buildId = new URL(self.location.href).searchParams.get("v");
  if (!buildId) throw new Error("The service worker has no build id");

  const manifestUrl = new URL(
    `precache-${encodeURIComponent(buildId)}.json`,
    self.registration.scope,
  );
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("The precache manifest could not be read");

  const paths = await response.json();
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string")) {
    throw new Error("The precache manifest is invalid");
  }

  const urls = paths.map((path) => new URL(path, self.registration.scope).href);
  if (urls.length > MAX_ENTRIES) {
    throw new Error("The app shell exceeds the offline cache limit");
  }

  const cache = await caches.open(CACHE);
  await cache.addAll(urls.map((url) => new Request(url, { cache: "reload" })));
  await trim(cache, new Set(urls));
}

self.addEventListener("install", (e) => {
  // Only replace a working worker once this build is completely cached. Cache
  // addAll is atomic, so a partial download can never become the offline shell.
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

// Every build leaves its predecessor's bundles behind. cache.keys() comes back
// in insertion order and put() re-inserts at the end, so dropping from the
// front sheds the oldest — a few builds' worth stays, which is all that offline
// needs.
async function put(req, res) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(req, res);
    await trim(cache);
  } catch {
    // Out of quota, most likely. A caching failure must not block the network
    // response; only the offline copy is lost.
  }
}

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // The update check has to see the deployed build id, never a cached one.
  if (url.pathname.endsWith("/version.json")) return;

  // Navigations go network-first so a deploy lands promptly, falling back to
  // the cached shell when offline. `no-store` stops the HTTP cache replaying a
  // stale index.html — it is what names the fingerprinted bundles, so an old
  // copy pins the whole app to an old build.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req.url, { cache: "no-store" })
        .then(async (res) => {
          await put(req, res.clone());
          return res;
        })
        .catch(() =>
          caches
            .match(req)
            .then((hit) => hit || caches.match(self.registration.scope)),
        ),
    );
    return;
  }

  // Fingerprinted assets are immutable, so cache-first is safe and fast.
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then(async (res) => {
          await put(req, res.clone());
          return res;
        }),
    ),
  );
});
