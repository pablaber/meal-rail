// Keeping an installed copy of the app current.
//
// An iOS home-screen PWA is not reloaded when you reopen it — Safari resumes the
// page it kept alive, sometimes for weeks. The service worker's network-first
// navigation handler only runs on an actual navigation, so a deploy can go
// unseen indefinitely. The page therefore asks, each time it comes back to the
// foreground, whether the build it is running is still the deployed one.

import { reloadedFor, markReloadedFor } from "./storage.js";

// Replaced at build time by vite.config.js.
export const BUILD_ID = __BUILD_ID__;

const VERSION_URL = `${import.meta.env.BASE_URL}version.json`;
const MIN_INTERVAL = 60000;

let lastCheck = 0;

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;
  // The build id rides in the query string: sw.js never changes, so without it
  // the browser would see the same script and keep the old worker forever.
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js?v=${BUILD_ID}`)
    .catch(() => {
      // Offline support is a nice-to-have; the app works fine without it.
    });
}

export function watchForUpdates() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
  checkForUpdate();
}

// Resolves to "current", "updating" (a reload is on its way), or "unknown" when
// the deployed version can't be read — offline, most likely.
export async function checkForUpdate({ force = false } = {}) {
  // The dev server has no version.json and nothing to update to. `npm run
  // preview` serves a real build, so that is where to exercise this.
  if (!import.meta.env.PROD) return "current";

  const now = Date.now();
  if (!force && now - lastCheck < MIN_INTERVAL) return "current";
  lastCheck = now;

  let deployed;
  try {
    const res = await fetch(VERSION_URL, { cache: "no-store" });
    if (!res.ok) return "unknown";
    deployed = (await res.json()).buildId;
  } catch {
    return "unknown";
  }

  if (!deployed || deployed === BUILD_ID) return "current";

  // We already reloaded for this build and are somehow still on the old one —
  // a CDN edge serving a new version.json beside a stale index.html will do
  // that. Reloading again would only spin. The next launch tries afresh.
  if (reloadedFor() === deployed) return "current";
  markReloadedFor(deployed);

  // Drop the caches first so the reload cannot be answered from the old build.
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    // Cache API unavailable or blocked — the reload still goes to the network.
  }

  location.reload();
  return "updating";
}
