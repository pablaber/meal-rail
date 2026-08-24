import { dayKey, RETENTION_DAYS, shiftDay } from "./day.js";
import { migratePlans } from "./plans.js";

// Persistence lives behind this module so the UI never talks to a storage API.
export const LOCAL_STATE_KEY = "mealrail:v1";
export const SYNC_META_KEY = "mealrail:sync:v1";
export const PAYLOAD_VERSION = 1;
export const DEVICE_LOCAL_SETTINGS = ["lastBackupAt"];

const FNV_OFFSET = 0x6c62272e07bb014262b821756295c58dn;
const FNV_PRIME = 0x0000000001000000000000000000013bn;
const FNV_MASK = (1n << 128n) - 1n;
const encoder = new TextEncoder();
const listeners = new Set();
const holds = new Set();
let knownState = null;
let knownMetadata;
let queue = Promise.resolve();
let pendingSave = null;
let saveScheduled = false;

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const clone = (value) => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();

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

const validResourceId = (id) =>
  id === "settings" ||
  (typeof id === "string" && id.startsWith("day:") && validDayKey(id.slice(4)));
const resourceParts = (id) =>
  id === "settings"
    ? { kind: "settings", key: "settings" }
    : { kind: "day", key: id.slice(4) };
const resourceId = (kind, key) =>
  kind === "settings" ? "settings" : `day:${key}`;

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues)
    globalThis.crypto.getRandomValues(bytes);
  else
    for (let i = 0; i < bytes.length; i += 1)
      bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes]
    .map(
      (byte, index) =>
        `${byte.toString(16).padStart(2, "0")}${[3, 5, 7, 9].includes(index) ? "-" : ""}`,
    )
    .join("");
}

function deviceDefaults(label, platform) {
  const ua = globalThis.navigator?.userAgent || "";
  if (label && platform) return { label, platform };
  if (/iPhone|iPad/.test(ua))
    return {
      label: label || (ua.includes("iPad") ? "iPad" : "iPhone"),
      platform: platform || "ios-safari",
    };
  if (/Android/.test(ua))
    return {
      label: label || "Android",
      platform:
        platform || (/Chrome/.test(ua) ? "android-chrome" : "android-browser"),
    };
  if (/Mac/.test(ua))
    return { label: label || "Mac", platform: platform || "macos-browser" };
  if (/Windows/.test(ua))
    return {
      label: label || "Windows PC",
      platform: platform || "windows-browser",
    };
  return { label: label || "Browser", platform: platform || "browser" };
}

function canonicalize(value, day = false) {
  if (Array.isArray(value))
    return value.map((entry) => canonicalize(entry, false));
  if (!isObject(value)) return value;
  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (entry === null || entry === undefined) continue;
    if (
      day &&
      ["checks", "notes", "unplanned", "workouts"].includes(key) &&
      ((isObject(entry) && !Object.keys(entry).length) ||
        (Array.isArray(entry) && !entry.length))
    )
      continue;
    if (day && key === "drinks" && entry === 0) continue;
    normalized[key] = canonicalize(entry, false);
  }
  return normalized;
}

export function fnv1a(value) {
  let hash = FNV_OFFSET;
  for (const byte of encoder.encode(value)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & FNV_MASK;
  }
  return hash.toString(16).padStart(32, "0");
}

export function canonicalResource(kind, payload) {
  let normalized;
  if (kind === "day") normalized = canonicalize(payload, true);
  else if (kind === "settings") {
    const settings = { ...payload };
    DEVICE_LOCAL_SETTINGS.forEach((key) => delete settings[key]);
    if (Array.isArray(settings.plans)) {
      settings.plans = [...settings.plans].sort((a, b) =>
        a.from.localeCompare(b.from),
      );
    }
    normalized = canonicalize(settings);
  } else {
    throw new Error("Unknown resource kind");
  }
  const canonical = JSON.stringify(normalized);
  return { payload: normalized, canonical, hash: fnv1a(canonical) };
}

function invalidBackup(detail) {
  throw new Error(`That backup can't be restored: ${detail}`);
}

function validateSlots(slots, path) {
  if (!Array.isArray(slots)) invalidBackup(`${path} must be a list`);
  slots.forEach((slot, index) => {
    if (!isObject(slot)) invalidBackup(`${path}[${index}] must be an object`);
    if (typeof slot.id !== "string" || !slot.id)
      invalidBackup(`${path}[${index}].id must be a non-empty string`);
    if (typeof slot.label !== "string")
      invalidBackup(`${path}[${index}].label must be a string`);
  });
}

function validateEntries(entries, path) {
  if (!Array.isArray(entries)) invalidBackup(`${path} must be a list`);
  entries.forEach((entry, index) => {
    if (!isObject(entry)) invalidBackup(`${path}[${index}] must be an object`);
    if (typeof entry.id !== "string" || !entry.id)
      invalidBackup(`${path}[${index}].id must be a non-empty string`);
    if (typeof entry.t !== "string" || !entry.t)
      invalidBackup(`${path}[${index}].t must be a non-empty string`);
    if ("note" in entry && typeof entry.note !== "string")
      invalidBackup(`${path}[${index}].note must be a string`);
  });
}

function validateStringMap(value, path) {
  if (!isObject(value)) invalidBackup(`${path} must be an object`);
  Object.entries(value).forEach(([key, entry]) => {
    if (!key || typeof entry !== "string" || !entry)
      invalidBackup(`${path} must contain non-empty string values`);
  });
}

function validateBackupShape(state) {
  if (!isObject(state)) invalidBackup("the top level must be an object");
  if (!isObject(state.settings)) invalidBackup("settings must be an object");
  if (!isObject(state.days)) invalidBackup("days must be an object");
  const settings = state.settings;
  ["trainingEnabled", "promptNotes", "promptSnackNotes"].forEach((key) => {
    if (key in settings && typeof settings[key] !== "boolean")
      invalidBackup(`settings.${key} must be true or false`);
  });
  ["stripMark", "stripGrade"].forEach((key) => {
    if (key in settings && typeof settings[key] !== "string")
      invalidBackup(`settings.${key} must be a string`);
  });
  if (
    "lastBackupAt" in settings &&
    (typeof settings.lastBackupAt !== "string" ||
      Number.isNaN(Date.parse(settings.lastBackupAt)))
  )
    invalidBackup("settings.lastBackupAt must be a valid timestamp");
  if ("slots" in settings) validateSlots(settings.slots, "settings.slots");
  if ("plans" in settings) {
    if (!Array.isArray(settings.plans))
      invalidBackup("settings.plans must be a list");
    settings.plans.forEach((plan, index) => {
      const path = `settings.plans[${index}]`;
      if (!isObject(plan)) invalidBackup(`${path} must be an object`);
      if (typeof plan.from !== "string" || !validDayKey(plan.from))
        invalidBackup(`${path}.from must be a YYYY-MM-DD date`);
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
    if ("unplanned" in record)
      validateEntries(record.unplanned, `${path}.unplanned`);
    if ("workouts" in record)
      validateEntries(record.workouts, `${path}.workouts`);
    if (
      "drinks" in record &&
      (!Number.isInteger(record.drinks) || record.drinks < 0)
    )
      invalidBackup(`${path}.drinks must be a non-negative whole number`);
    if (
      "planned" in record &&
      (!Number.isInteger(record.planned) || record.planned < 0)
    )
      invalidBackup(`${path}.planned must be a non-negative whole number`);
    if ("training" in record && typeof record.training !== "boolean")
      invalidBackup(`${path}.training must be true or false`);
  });
}

function migrateDay(record) {
  if (!record || !record.training) return record;
  const { training, ...day } = record;
  const checks = { ...(day.checks || {}) };
  const notes = { ...(day.notes || {}) };
  const timestamp = checks.__training;
  delete checks.__training;
  const note = notes.__training;
  delete notes.__training;
  day.checks = checks;
  if (Object.keys(notes).length) day.notes = notes;
  else delete day.notes;
  if (timestamp)
    day.workouts = [
      ...(day.workouts || []),
      { id: `w${timestamp}`, t: timestamp, note: note || undefined },
    ];
  else if (typeof day.planned === "number")
    day.planned = Math.max(0, day.planned - 1);
  return day;
}

function migrate(state) {
  if (!state || typeof state !== "object" || !state.days) return state;
  const days = Object.fromEntries(
    Object.entries(state.days).map(([key, value]) => [key, migrateDay(value)]),
  );
  let settings = { ...(state.settings || {}) };
  if (!("promptNotes" in settings) && "promptSnackNotes" in settings)
    settings.promptNotes = settings.promptSnackNotes;
  delete settings.promptSnackNotes;
  settings = migratePlans(settings, days, dayKey());
  return { settings, days };
}

function validBase(base) {
  return (
    isObject(base) &&
    Object.entries(base).every(
      ([id, entry]) =>
        validResourceId(id) &&
        isObject(entry) &&
        Number.isInteger(entry.rev) &&
        entry.rev >= 1 &&
        Number.isInteger(entry.seq) &&
        entry.seq >= 1 &&
        typeof entry.deleted === "boolean" &&
        (entry.deleted
          ? entry.hash === null && entry.payloadVersion === null
          : typeof entry.hash === "string" &&
            entry.payloadVersion === PAYLOAD_VERSION),
    )
  );
}

function validPending(pending) {
  const ids = new Set();
  return (
    Array.isArray(pending) &&
    pending.every((entry) => {
      const id = resourceId(entry.kind, entry.key);
      const valid =
        isObject(entry) &&
        (entry.kind === "settings" || entry.kind === "day") &&
        validResourceId(id) &&
        (entry.op === "write" ||
          (entry.op === "delete" && entry.kind === "day")) &&
        Number.isInteger(entry.expectedRev) &&
        entry.expectedRev >= 0 &&
        (entry.op === "write"
          ? entry.payloadVersion === PAYLOAD_VERSION &&
            typeof entry.payloadHash === "string"
          : entry.payloadVersion === null && entry.payloadHash === null) &&
        (entry.state === "queued" || entry.state === "inflight") &&
        typeof entry.mutationId === "string" &&
        typeof entry.queuedAt === "string" &&
        Number.isInteger(entry.attempts) &&
        entry.attempts >= 0 &&
        (entry.nextAttemptAt === null ||
          typeof entry.nextAttemptAt === "string") &&
        typeof entry.dirtyAgain === "boolean" &&
        typeof entry.recreatedOnce === "boolean" &&
        (entry.lastError === null || typeof entry.lastError === "string") &&
        (!("sentPayload" in entry) ||
          (entry.op === "write" && isObject(entry.sentPayload)));
      if (ids.has(id)) return false;
      ids.add(id);
      return valid;
    })
  );
}

function validMetadata(metadata) {
  return (
    isObject(metadata) &&
    isObject(metadata.device) &&
    typeof metadata.device.deviceId === "string" &&
    typeof metadata.device.label === "string" &&
    typeof metadata.device.platform === "string" &&
    typeof metadata.device.firstSeenAt === "string" &&
    typeof metadata.device.lastSeenAt === "string" &&
    (metadata.account === null ||
      (isObject(metadata.account) &&
        typeof metadata.account.userId === "string" &&
        metadata.account.userId)) &&
    typeof metadata.needsReconcile === "boolean" &&
    Number.isInteger(metadata.cursor) &&
    metadata.cursor >= 0 &&
    validBase(metadata.base) &&
    validPending(metadata.pending) &&
    isObject(metadata.conflicts) &&
    isObject(metadata.staging) &&
    Object.keys(metadata.staging).every(validResourceId) &&
    Array.isArray(metadata.quarantined) &&
    metadata.quarantined.every(validResourceId) &&
    (metadata.lastSyncedAt === null ||
      typeof metadata.lastSyncedAt === "string")
  );
}

function readMetadata() {
  let raw;
  try {
    raw = localStorage.getItem(SYNC_META_KEY);
  } catch {
    return { status: "corrupt" };
  }
  if (raw === null) return { status: "absent" };
  try {
    const parsed = JSON.parse(raw);
    return validMetadata(parsed)
      ? { status: "valid", metadata: parsed }
      : { status: "corrupt" };
  } catch {
    return { status: "corrupt" };
  }
}

function emit(event) {
  for (const listener of listeners) listener(clone(event));
}

function statusEvent(status, metadata, detail = null) {
  emit({
    type: "status",
    status,
    lastSyncedAt: metadata?.lastSyncedAt ?? null,
    pendingCount: metadata?.pending.length ?? 0,
    detail,
  });
}

function resources(state) {
  return [
    ["settings", canonicalResource("settings", state.settings)],
    ...Object.keys(state.days)
      .sort()
      .map((key) => [`day:${key}`, canonicalResource("day", state.days[key])]),
  ];
}

function mutation(id, resource, base) {
  const { kind, key } = resourceParts(id);
  return {
    mutationId: uuid(),
    kind,
    key,
    op: resource ? "write" : "delete",
    expectedRev: base?.rev || 0,
    payloadVersion: resource ? PAYLOAD_VERSION : null,
    payloadHash: resource ? resource.hash : null,
    state: "queued",
    queuedAt: now(),
    attempts: 0,
    nextAttemptAt: null,
    dirtyAgain: false,
    recreatedOnce: false,
    lastError: null,
  };
}

function deriveMetadata(state, metadata) {
  const next = clone(metadata);
  const current = new Map(resources(state));
  const cutoff = shiftDay(dayKey(), -RETENTION_DAYS);
  const ids = [...new Set([...current.keys(), ...Object.keys(next.base)])].sort(
    (a, b) =>
      a === "settings" ? -1 : b === "settings" ? 1 : a.localeCompare(b),
  );
  for (const id of ids) {
    if (next.quarantined.includes(id)) continue;
    const local = current.get(id);
    const base = next.base[id];
    const pendingIndex = next.pending.findIndex(
      (entry) => resourceId(entry.kind, entry.key) === id,
    );
    if (!local && id !== "settings" && base && id.slice(4) < cutoff) {
      delete next.base[id];
      delete next.staging[id];
      next.quarantined = next.quarantined.filter((value) => value !== id);
      if (pendingIndex >= 0) next.pending.splice(pendingIndex, 1);
      continue;
    }
    const desired =
      !local && base
        ? mutation(id, null, base)
        : local && (!base || base.deleted || local.hash !== base.hash)
          ? mutation(id, local, base)
          : null;
    if (!desired) continue;
    if (pendingIndex < 0) next.pending.push(desired);
    else if (next.pending[pendingIndex].state === "queued")
      next.pending[pendingIndex] = desired;
    else if (
      next.pending[pendingIndex].payloadHash !== desired.payloadHash ||
      next.pending[pendingIndex].op !== desired.op
    )
      next.pending[pendingIndex].dirtyAgain = true;
  }
  return next;
}

function enqueue(operation) {
  queue = queue.then(operation, operation);
  return queue;
}

export async function load() {
  let raw;
  try {
    raw = localStorage.getItem(LOCAL_STATE_KEY);
  } catch {
    return { status: "unreadable", raw: null, reason: "storage" };
  }
  if (raw === null) return { status: "absent" };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.days)
      return { status: "unreadable", raw, reason: "data" };
    const state = migrate(parsed);
    knownState = clone(state);
    const read = readMetadata();
    knownMetadata = read.status === "valid" ? read.metadata : undefined;
    if (
      read.status === "valid" &&
      read.metadata.account &&
      !read.metadata.needsReconcile
    ) {
      const derived = deriveMetadata(state, read.metadata);
      knownMetadata = derived;
      if (JSON.stringify(derived) !== JSON.stringify(read.metadata)) {
        try {
          localStorage.setItem(SYNC_META_KEY, JSON.stringify(derived));
        } catch {
          knownMetadata = read.metadata;
          statusEvent("failed", read.metadata, "storage");
        }
      }
    }
    if (read.status === "corrupt") statusEvent("reconciling", null);
    return { status: "valid", state };
  } catch {
    return { status: "unreadable", raw, reason: "data" };
  }
}

export function save(state) {
  return new Promise((resolve) => {
    if (!pendingSave) pendingSave = { state, resolvers: [] };
    else pendingSave.state = state;
    pendingSave.resolvers.push(resolve);
    if (!saveScheduled) {
      saveScheduled = true;
      queueMicrotask(() => {
        const batch = pendingSave;
        pendingSave = null;
        saveScheduled = false;
        enqueue(() => {
          try {
            localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(batch.state));
          } catch {
            return false;
          }
          knownState = clone(batch.state);
          const read = knownMetadata
            ? { status: "valid", metadata: knownMetadata }
            : readMetadata();
          if (
            read.status === "valid" &&
            read.metadata.account &&
            !read.metadata.needsReconcile
          ) {
            const next = deriveMetadata(batch.state, read.metadata);
            try {
              localStorage.setItem(SYNC_META_KEY, JSON.stringify(next));
              knownMetadata = next;
              statusEvent(next.pending.length ? "pending" : "synced", next);
            } catch {
              knownMetadata = read.metadata;
              statusEvent("failed", read.metadata, "storage");
            }
          }
          return true;
        }).then((result) =>
          batch.resolvers.forEach((resolveSave) => resolveSave(result)),
        );
      });
    }
  });
}

export function getSyncMetadata() {
  return enqueue(() => {
    const read = readMetadata();
    knownMetadata = read.status === "valid" ? read.metadata : undefined;
    return read.status === "valid"
      ? { status: "valid", metadata: clone(read.metadata) }
      : read;
  });
}

export function initializeSyncMetadata({ userId, label, platform }) {
  return enqueue(() => {
    if (typeof userId !== "string" || !userId) return false;
    const prior =
      readMetadata().status === "valid" ? readMetadata().metadata : null;
    const at = now();
    const device = prior?.device || {
      deviceId: uuid(),
      ...deviceDefaults(label, platform),
      firstSeenAt: at,
      lastSeenAt: at,
    };
    const metadata = {
      ...(prior || {}),
      device: {
        ...device,
        ...deviceDefaults(label || device.label, platform || device.platform),
        lastSeenAt: at,
      },
      account: { userId },
      needsReconcile: true,
      cursor: 0,
      base: {},
      pending: [],
      conflicts: {},
      staging: {},
      quarantined: [],
      lastSyncedAt: null,
    };
    try {
      localStorage.setItem(SYNC_META_KEY, JSON.stringify(metadata));
    } catch {
      return false;
    }
    knownMetadata = metadata;
    statusEvent("reconciling", metadata);
    return true;
  });
}

export function disableSyncMetadata() {
  return enqueue(() => {
    try {
      localStorage.removeItem(SYNC_META_KEY);
    } catch {
      return false;
    }
    knownMetadata = undefined;
    statusEvent("off", null);
    return true;
  });
}

export function updateSyncMetadata(updater) {
  return enqueue(() => {
    const read = readMetadata();
    if (read.status !== "valid") return false;
    let next;
    try {
      next = updater(clone(read.metadata));
    } catch {
      return false;
    }
    if (!validMetadata(next)) return false;
    try {
      localStorage.setItem(SYNC_META_KEY, JSON.stringify(next));
    } catch {
      return false;
    }
    knownMetadata = next;
    return true;
  });
}

export function preparePendingMutation(id) {
  return enqueue(() => {
    if (!validResourceId(id) || !knownState) return null;
    const read = readMetadata();
    if (read.status !== "valid") return null;
    const metadata = read.metadata;
    const index = metadata.pending.findIndex(
      (entry) => resourceId(entry.kind, entry.key) === id,
    );
    if (index < 0) return null;
    let entry = metadata.pending[index];
    if (entry.nextAttemptAt && entry.nextAttemptAt > now()) return null;
    const current =
      id === "settings"
        ? canonicalResource("settings", knownState.settings)
        : knownState.days[id.slice(4)]
          ? canonicalResource("day", knownState.days[id.slice(4)])
          : null;
    if (
      entry.state === "queued" &&
      (entry.op !== (current ? "write" : "delete") ||
        (current && entry.payloadHash !== current.hash))
    ) {
      entry = mutation(id, current, metadata.base[id]);
      metadata.pending[index] = entry;
    }
    if (entry.state === "queued") {
      entry = {
        ...entry,
        state: "inflight",
        ...(entry.op === "write" ? { sentPayload: current.payload } : {}),
      };
      metadata.pending[index] = entry;
      try {
        localStorage.setItem(SYNC_META_KEY, JSON.stringify(metadata));
      } catch {
        return null;
      }
      knownMetadata = metadata;
    }
    return {
      mutation: clone(entry),
      payload: entry.op === "write" ? clone(entry.sentPayload) : null,
    };
  });
}

export function commitRemoteState({ state, metadata, origin }) {
  return enqueue(() => {
    if (!["remote", "reconcile"].includes(origin) || !validMetadata(metadata))
      return { localSaved: false, metadataSaved: false };
    let localSaved = false;
    try {
      localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
      localSaved = true;
      knownState = clone(state);
      emit({ type: "state", state, origin });
    } catch {
      return { localSaved, metadataSaved: false };
    }
    try {
      localStorage.setItem(SYNC_META_KEY, JSON.stringify(metadata));
      knownMetadata = clone(metadata);
      return { localSaved, metadataSaved: true };
    } catch {
      statusEvent("failed", metadata, "storage");
      return { localSaved, metadataSaved: false };
    }
  });
}

export function restore(state) {
  return enqueue(() => {
    const read = readMetadata();
    if (read.status === "valid") {
      const metadata = {
        ...read.metadata,
        needsReconcile: true,
        cursor: 0,
        base: {},
        pending: [],
        conflicts: {},
        staging: {},
        quarantined: [],
        lastSyncedAt: null,
      };
      try {
        localStorage.setItem(SYNC_META_KEY, JSON.stringify(metadata));
        knownMetadata = metadata;
      } catch {
        return false;
      }
    }
    try {
      localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
      knownState = clone(state);
      return true;
    } catch {
      return false;
    }
  });
}

export function clear() {
  return enqueue(() => {
    try {
      localStorage.removeItem(SYNC_META_KEY);
    } catch {
      return false;
    }
    try {
      localStorage.removeItem(LOCAL_STATE_KEY);
    } catch {
      return false;
    }
    knownState = null;
    knownMetadata = undefined;
    holds.clear();
    statusEvent("off", null);
    return true;
  });
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitSyncEvent(event) {
  const valid =
    isObject(event) &&
    ((event.type === "state" &&
      isObject(event.state) &&
      ["remote", "reconcile"].includes(event.origin)) ||
      (event.type === "status" &&
        typeof event.status === "string" &&
        (event.lastSyncedAt === null ||
          typeof event.lastSyncedAt === "string") &&
        Number.isInteger(event.pendingCount) &&
        event.pendingCount >= 0 &&
        (event.detail === null || typeof event.detail === "string")) ||
      (event.type === "conflicts" && isObject(event.conflicts)) ||
      (event.type === "remote-pending" &&
        Array.isArray(event.resources) &&
        event.resources.every(validResourceId)));
  if (!valid) throw new Error("Invalid sync event");
  emit(event);
}

export function holdResource(id) {
  if (!validResourceId(id)) throw new Error("Invalid resource id");
  holds.add(id);
}

export function releaseResource(id) {
  if (!validResourceId(id)) throw new Error("Invalid resource id");
  holds.delete(id);
  if (knownMetadata?.staging[id])
    emitSyncEvent({ type: "remote-pending", resources: [id] });
}

export function isResourceHeld(id) {
  if (!validResourceId(id)) throw new Error("Invalid resource id");
  return holds.has(id);
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
