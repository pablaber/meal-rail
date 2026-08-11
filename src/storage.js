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
    day.workouts = [
      ...(day.workouts || []),
      { id: `w${t}`, t, note: note || undefined },
    ];
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
  const settings = { ...(state.settings || {}) };
  // This began as a snack-only prompt. Keep its value when loading an install
  // or backup from that release, but store only the generic setting from now on.
  if (!("promptNotes" in settings) && "promptSnackNotes" in settings) {
    settings.promptNotes = settings.promptSnackNotes;
  }
  delete settings.promptSnackNotes;
  return { ...state, settings, days };
}

export async function load() {
  let raw;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return { status: "unreadable", raw: null, reason: "storage" };
  }

  if (raw === null) return { status: "absent" };

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.days) {
      return { status: "unreadable", raw, reason: "data" };
    }
    return { status: "valid", state: migrate(parsed) };
  } catch {
    // Keep the exact value available to the recovery screen. Nothing writes to
    // or removes it until the user has had a chance to take that copy away.
    return { status: "unreadable", raw, reason: "data" };
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
// These let you take a backup and move between devices by hand: two ways out and
// two ways in, all four carrying the same JSON. A file is what you keep; the
// clipboard is for a phone with nowhere good to put one, which can paste a
// backup into a message to itself and read it back on the other device.
const serialize = (state) => JSON.stringify(state, null, 2);

function downloadText(text, filename) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// The one gate every restore comes through, whichever way the text arrived. Its
// messages are written for the status line and the paste dialog, which is where
// they end up, so they say "that" rather than "that file".
function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That isn't valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || !parsed.days) {
    throw new Error("That isn't a Meal Rail backup");
  }
  // A restored backup skips load(), so it gets the same migration here.
  return migrate(parsed);
}

export function exportFile(state) {
  downloadText(
    serialize(state),
    `meal-rail-${new Date().toISOString().slice(0, 10)}.json`,
  );
}

export function exportRawFile(raw) {
  downloadText(
    raw,
    `meal-rail-recovery-${new Date().toISOString().slice(0, 10)}.txt`,
  );
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
        resolve(parseBackup(await file.text()));
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}

export async function exportClipboard(state) {
  return copyText(serialize(state));
}

export async function exportRawClipboard(raw) {
  return copyText(raw);
}

async function copyText(text) {
  // `navigator.clipboard` is undefined outside a secure context, which is
  // exactly what a build served over the LAN to a phone is — the way this app
  // gets tested. The selection-based copy below still works there, so the
  // availability check is synchronous and the fallback runs inside the same tap.
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Denied, or the document lost focus. Worth one more try.
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    // iOS ignores select() on a textarea and copies nothing without this.
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// The clipboard's counterpart to `importFile`. Reading the clipboard is a
// permission prompt on some platforms and silently unavailable on others, so
// what comes in is text the user pasted into a field themselves — which also
// means an unreadable backup can be fixed where it stands instead of vanishing
// with the dialog.
export function importText(text) {
  return parseBackup(text);
}
