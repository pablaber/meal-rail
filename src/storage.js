// Persistence lives behind this module so the UI never talks to a storage API
// directly. Today it is localStorage; swapping in IndexedDB, or a fetch() to a
// Fastify server for cross-device sync, means changing only this file.

const KEY = "mealrail:v1";

export async function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    // Quota exceeded, or Safari private browsing. The app keeps working for
    // this session; the UI surfaces the failure so nothing is silently lost.
    return false;
  }
}

export async function clear() {
  try {
    localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

// The update check (src/update.js) reloads the page when it finds a newer build
// deployed. This remembers which build that was, so a reload that somehow lands
// on the old version again can't turn into a loop. Session-scoped and
// synchronous on purpose: it has to survive the reload it guards and nothing
// more, and the decision to reload can't wait on a promise.
const RELOAD_KEY = "mealrail:reloaded-for";

export function reloadedFor() {
  try {
    return sessionStorage.getItem(RELOAD_KEY);
  } catch {
    return null;
  }
}

export function markReloadedFor(buildId) {
  try {
    sessionStorage.setItem(RELOAD_KEY, buildId);
  } catch {
    // Without the guard an update still applies; it just isn't loop-proof.
  }
}

// localStorage is per-browser and per-device, and clearing site data wipes it.
// These two let you take a backup and move between devices by hand.
export function exportFile(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `meal-rail-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error("No file chosen"));
      try {
        const parsed = JSON.parse(await file.text());
        if (!parsed || typeof parsed !== "object" || !parsed.days) {
          return reject(new Error("That file isn't a Meal Rail backup"));
        }
        resolve(parsed);
      } catch {
        reject(new Error("That file isn't valid JSON"));
      }
    };
    input.click();
  });
}
