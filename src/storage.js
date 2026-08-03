// Persistence lives behind this module so the UI never talks to a storage API
// directly. Today it is localStorage; swapping in IndexedDB, or a fetch() to a
// Fastify server for cross-device sync, means changing only this file.

const KEY = "mealrail:v1";

// A training day used to be a flag that appended one more slot to the day, which
// you then checked off yourself. It is now a workout snack: an entry that
// arrives already checked, like the unplanned list beside it. Old days and old
// backup files are rewritten into that shape on the way in, so the key can stay
// at v1 and nothing in the app has to know the flag ever existed.
//
// A training day that was checked becomes a workout at the same time, leaving
// the day's `planned` and its grade exactly where they were. A training day that
// was never checked becomes nothing — the new model has no way to say "meant to
// work out and didn't" — so its `planned` gives the slot back. That day can go
// from green to gold, which is the honest reading: every slot it actually had is
// accounted for.
function migrateDay(r) {
  if (!r || !r.training) return r;
  const { training, ...day } = r;
  const checks = { ...(day.checks || {}) };
  const notes = { ...(day.notes || {}) };
  const t = checks["__training"];
  delete checks["__training"];
  const note = notes["__training"];
  delete notes["__training"];

  day.checks = checks;
  if (Object.keys(notes).length) day.notes = notes;
  else delete day.notes;

  if (t) {
    day.workouts = [...(day.workouts || []), { id: `w${t}`, t, note: note || undefined }];
  } else if (typeof day.planned === "number") {
    day.planned = Math.max(0, day.planned - 1);
  }
  return day;
}

function migrate(state) {
  if (!state || typeof state !== "object" || !state.days) return state;
  const days = {};
  Object.keys(state.days).forEach((k) => {
    days[k] = migrateDay(state.days[k]);
  });
  return { ...state, days };
}

export async function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? migrate(JSON.parse(raw)) : null;
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
        // A restored backup skips load(), so it gets the same migration here.
        resolve(migrate(parsed));
      } catch {
        reject(new Error("That file isn't valid JSON"));
      }
    };
    input.click();
  });
}
