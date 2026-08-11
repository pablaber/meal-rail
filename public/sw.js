// Minimal offline cache. Vite fingerprints asset filenames, so a runtime
// cache-first strategy keeps whatever has been fetched and picks up new
// builds automatically without a precache manifest to maintain.
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

self.addEventListener("install", () => self.skipWaiting());

// Every build leaves its predecessor's bundles behind. cache.keys() comes back
// in insertion order and put() re-inserts at the end, so dropping from the
// front sheds the oldest — a few builds' worth stays, which is all that offline
// needs.
async function put(req, res) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(req, res);
    const keys = await cache.keys();
    await Promise.all(
      keys.slice(0, keys.length - MAX_ENTRIES).map((k) => cache.delete(k)),
    );
  } catch {
    // Out of quota, most likely. The response is already on its way to the
    // page; only the offline copy is lost.
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
        .then((res) => {
          put(req, res.clone());
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match("./")),
        ),
    );
    return;
  }

  // Fingerprinted assets are immutable, so cache-first is safe and fast.
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          put(req, res.clone());
          return res;
        }),
    ),
  );
});
