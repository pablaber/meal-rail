import { dayKey } from "./day.js";
import { migratePlans } from "./plans.js";

// Persistence lives behind this module so the UI never talks to a storage API
// directly. Today it is localStorage; swapping in IndexedDB, or a fetch() to a
// Fastify server for cross-device sync, means changing only this file.

const KEY = "mealrail:v1";

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const validDayKey = (key) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
};

const invalidBackup = (detail) => {
  throw new Error(`That backup can't be restored: ${detail}`);
};

function validateSlots(slots, path) {
  if (!Array.isArray(slots)) invalidBackup(`${path} must be a list`);
  slots.forEach((slot, index) => {
    if (!isObject(slot)) invalidBackup(`${path}[${index}] must be an object`);
    if (typeof slot.id !== "string" || !slot.id) {
      invalidBackup(`${path}[${index}].id must be a non-empty string`);
    }
    if (typeof slot.label !== "string") {
      invalidBackup(`${path}[${index}].label must be a string`);
    }
  });
}

function validateEntries(entries, path) {
  if (!Array.isArray(entries)) invalidBackup(`${path} must be a list`);
  entries.forEach((entry, index) => {
    if (!isObject(entry)) {
      invalidBackup(`${path}[${index}] must be an object`);
    }
    if (typeof entry.id !== "string" || !entry.id) {
      invalidBackup(`${path}[${index}].id must be a non-empty string`);
    }
    if (typeof entry.t !== "string" || !entry.t) {
      invalidBackup(`${path}[${index}].t must be a non-empty string`);
    }
    if ("note" in entry && typeof entry.note !== "string") {
      invalidBackup(`${path}[${index}].note must be a string`);
    }
  });
}

function validateStringMap(value, path) {
  if (!isObject(value)) invalidBackup(`${path} must be an object`);
  Object.entries(value).forEach(([key, entry]) => {
    if (!key || typeof entry !== "string" || !entry) {
      invalidBackup(`${path} must contain non-empty string values`);
    }
  });
}

function validateBackupShape(state) {
  if (!isObject(state)) invalidBackup("the top level must be an object");
  if (!isObject(state.settings)) {
    invalidBackup("settings must be an object");
  }
  if (!isObject(state.days)) invalidBackup("days must be an object");

  const settings = state.settings;
  ["trainingEnabled", "promptNotes", "promptSnackNotes"].forEach((key) => {
    if (key in settings && typeof settings[key] !== "boolean") {
      invalidBackup(`settings.${key} must be true or false`);
    }
  });
  ["stripMark", "stripGrade"].forEach((key) => {
    if (key in settings && typeof settings[key] !== "string") {
      invalidBackup(`settings.${key} must be a string`);
    }
  });
  if (
    "lastBackupAt" in settings &&
    (typeof settings.lastBackupAt !== "string" ||
      Number.isNaN(Date.parse(settings.lastBackupAt)))
  ) {
    invalidBackup("settings.lastBackupAt must be a valid timestamp");
  }
  if ("slots" in settings) validateSlots(settings.slots, "settings.slots");
  if ("plans" in settings) {
    if (!Array.isArray(settings.plans)) {
      invalidBackup("settings.plans must be a list");
    }
    settings.plans.forEach((plan, index) => {
      const path = `settings.plans[${index}]`;
      if (!isObject(plan)) invalidBackup(`${path} must be an object`);
      if (typeof plan.from !== "string" || !validDayKey(plan.from)) {
        invalidBackup(`${path}.from must be a YYYY-MM-DD date`);
      }
      validateSlots(plan.slots, `${path}.slots`);
    });
  }

  Object.entries(state.days).forEach(([key, record]) => {
    const path = `days.${key}`;
    if (!validDayKey(key))
      invalidBackup(`days contains an invalid date: ${key}`);
    if (!isObject(record)) invalidBackup(`${path} must be an object`);
    if ("checks" in record) validateStringMap(record.checks, `${path}.checks`);
    if ("notes" in record) validateStringMap(record.notes, `${path}.notes`);
    if ("unplanned" in record) {
      validateEntries(record.unplanned, `${path}.unplanned`);
    }
    if ("workouts" in record) {
      validateEntries(record.workouts, `${path}.workouts`);
    }
    if (
      "drinks" in record &&
      (!Number.isInteger(record.drinks) || record.drinks < 0)
    ) {
      invalidBackup(`${path}.drinks must be a non-negative whole number`);
    }
    if (
      "planned" in record &&
      (!Number.isInteger(record.planned) || record.planned < 0)
    ) {
      invalidBackup(`${path}.planned must be a non-negative whole number`);
    }
    if ("training" in record && typeof record.training !== "boolean") {
      invalidBackup(`${path}.training must be true or false`);
    }
  });
}

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
  let settings = { ...(state.settings || {}) };
  // This began as a snack-only prompt. Keep its value when loading an install
  // or backup from that release, but store only the generic setting from now on.
  if (!("promptNotes" in settings) && "promptSnackNotes" in settings) {
    settings.promptNotes = settings.promptSnackNotes;
  }
  delete settings.promptSnackNotes;
  settings = migratePlans(settings, days, dayKey());
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

function downloadBlob(blob, filename) {
  let url;
  let anchor;
  try {
    url = URL.createObjectURL(blob);
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    return true;
  } catch {
    return false;
  } finally {
    anchor?.remove();
    if (url) {
      // Let the click consume the URL before releasing it. This also runs when
      // creating or clicking the anchor throws, so a failed export cannot leak
      // its object URL for the rest of the session.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
}

function downloadText(text, filename, type = "application/json") {
  return downloadBlob(new Blob([text], { type }), filename);
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
  validateBackupShape(parsed);
  // A restored backup skips load(), so it gets the same migration here.
  const migrated = migrate(parsed);
  validateBackupShape(migrated);
  return migrated;
}

export async function exportFile(state) {
  const filename = `meal-rail-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([serialize(state)], { type: "application/json" });
  const file =
    typeof File === "undefined"
      ? null
      : new File([blob], filename, { type: blob.type });

  if (file && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: "Meal Rail backup",
      });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
      // A browser can advertise file sharing and still reject at runtime. The
      // download path remains a useful fallback in that case.
    }
  }

  return downloadBlob(file || blob, filename) ? "downloaded" : "failed";
}

export function exportRawFile(raw) {
  return downloadText(
    raw,
    `meal-rail-recovery-${new Date().toISOString().slice(0, 10)}.txt`,
    "text/plain",
  );
}

export function importFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    let settled = false;
    let focusTimer = 0;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(focusTimer);
      window.removeEventListener("focus", onFocus);
      callback(value);
    };
    const cancel = () => finish(resolve, null);
    const onFocus = () => {
      // `change` is dispatched as the picker closes when a file was selected.
      // Give it one task to win before treating the returned focus as Cancel.
      focusTimer = setTimeout(() => {
        if (!input.files?.length) cancel();
      }, 0);
    };

    input.type = "file";
    input.accept = "application/json";
    input.addEventListener("cancel", cancel, { once: true });
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return cancel();
      try {
        finish(resolve, parseBackup(await file.text()));
      } catch (e) {
        finish(reject, e);
      }
    };
    window.addEventListener("focus", onFocus);
    try {
      input.click();
    } catch (error) {
      finish(reject, error);
    }
  });
}

export function summarizeBackup(state) {
  const dates = Object.keys(state.days).sort();
  return {
    dayCount: dates.length,
    firstDay: dates[0] || null,
    lastDay: dates.at(-1) || null,
    checks: Object.values(state.days).reduce(
      (count, record) => count + Object.keys(record.checks || {}).length,
      0,
    ),
    snacks: Object.values(state.days).reduce(
      (count, record) => count + (record.unplanned || []).length,
      0,
    ),
    workouts: Object.values(state.days).reduce(
      (count, record) => count + (record.workouts || []).length,
      0,
    ),
    drinks: Object.values(state.days).reduce(
      (count, record) => count + (record.drinks || 0),
      0,
    ),
  };
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
