import {
  PAYLOAD_VERSION,
  canonicalResource,
  commitRemoteState,
  createPendingMutation,
  emitSyncEvent,
  getLocalState,
  getSyncMetadata,
  isResourceHeld,
  normalizeRemotePayload,
  preparePendingMutation,
  resourceId,
  resourceParts,
  subscribe as subscribeStorage,
  updateSyncMetadata,
} from "./storage.js";
import {
  getAuthState,
  getAuthenticatedSupabase,
  refreshAuthSession,
  subscribeAuth,
} from "./auth.js";
import { consumeRpcRetryAfter } from "./auth.js";
import { RETENTION_DAYS, dayKey, shiftDay } from "./day.js";

export const PROTOCOL_VERSION = 1;
export const PULL_PAGE_DEFAULT = 200;
export const SAVE_DEBOUNCE_MS = 750;
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 300000;
export const RATE_LIMIT_FLOOR_MS = 30000;

const clone = (value) => JSON.parse(JSON.stringify(value));
const retentionFloor = () => shiftDay(dayKey(), -RETENTION_DAYS);
const isOldDay = (id) =>
  id.startsWith("day:") && id.slice(4) < retentionFloor();
const envelopeId = (envelope) => resourceId(envelope.kind, envelope.key);
const validEnvelope = (envelope) =>
  envelope &&
  (envelope.kind === "settings" || envelope.kind === "day") &&
  typeof envelope.key === "string" &&
  Number.isInteger(envelope.rev) &&
  envelope.rev >= 1 &&
  Number.isInteger(envelope.seq) &&
  envelope.seq >= 1 &&
  typeof envelope.deleted === "boolean" &&
  (envelope.deleted
    ? envelope.payload === null && envelope.payload_version === null
    : Number.isInteger(envelope.payload_version) &&
      envelope.payload_version >= 1 &&
      envelope.payload &&
      typeof envelope.payload === "object");

function baseFor(envelope, resource = null) {
  return {
    rev: envelope.rev,
    seq: envelope.seq,
    hash: envelope.deleted ? null : resource.hash,
    deleted: envelope.deleted,
    payloadVersion: envelope.deleted ? null : envelope.payload_version,
  };
}

function sortedConflicts(conflicts) {
  return Object.fromEntries(
    Object.entries(conflicts).sort(([a], [b]) =>
      a === "settings" ? -1 : b === "settings" ? 1 : a.localeCompare(b),
    ),
  );
}

export function createSyncEngine(dependencies = {}) {
  const storage = dependencies.storage || {
    getLocalState,
    getSyncMetadata,
    updateSyncMetadata,
    commitRemoteState,
    preparePendingMutation,
    createPendingMutation,
    normalizeRemotePayload,
    canonicalResource,
    resourceId,
    resourceParts,
    isResourceHeld,
    emitSyncEvent,
    subscribe: subscribeStorage,
  };
  const auth = dependencies.auth || {
    getAuthState,
    getAuthenticatedSupabase,
    refreshAuthSession,
    subscribeAuth,
  };
  const protocolVersion = dependencies.protocolVersion ?? PROTOCOL_VERSION;
  const payloadVersion = dependencies.payloadVersion ?? PAYLOAD_VERSION;
  const clock = dependencies.clock || (() => Date.now());
  const rng = dependencies.random || Math.random;
  const timers = dependencies.timers || globalThis;
  const navigatorRef = dependencies.navigator ||
    globalThis.navigator || { onLine: true };
  const events = dependencies.events || globalThis;
  const retryAfter = dependencies.consumeRpcRetryAfter || consumeRpcRetryAfter;
  let running = false;
  let started = false;
  let phases = [];
  let debounce = null;
  let backoff = null;
  let abort = null;
  let unsubscribeStorage = null;
  let unsubscribeAuth = null;
  let ownStatus = false;

  const enqueue = (...next) => {
    for (const phase of next) if (phases.at(-1) !== phase) phases.push(phase);
    void run();
  };
  const status = async (detail = null, forced = null) => {
    const read = await storage.getSyncMetadata();
    const metadata = read?.metadata;
    if (!metadata) return;
    const authState = auth.getAuthState?.() || {};
    let value = forced;
    if (!value) {
      if (!metadata.account) value = "off";
      else if (metadata.needsReconcile) value = "reconciling";
      else if (authState.status !== "signed_in") value = "auth_required";
      else if (
        metadata.halt ||
        Object.keys(metadata.rejected || {}).length ||
        Object.keys(metadata.quarantineVersions || {}).length
      )
        value = "failed";
      else if (!navigatorRef.onLine && metadata.pending.length)
        value = "offline";
      else if (Object.keys(metadata.conflicts).length) value = "conflict";
      else if (metadata.pending.length || backoff) value = "pending";
      else value = "synced";
    }
    ownStatus = true;
    storage.emitSyncEvent({
      type: "status",
      status: value,
      lastSyncedAt: metadata.lastSyncedAt,
      pendingCount: metadata.pending.length,
      detail,
    });
    ownStatus = false;
  };
  const persist = async (updater) => storage.updateSyncMetadata(updater);
  const stopTimer = () => {
    if (backoff) timers.clearTimeout(backoff);
    backoff = null;
  };
  const pause = async (mutation, error, rpcName) => {
    const code = error?.status || error?.code || 0;
    const attempts = mutation.attempts;
    const bound = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempts);
    const wait =
      code === 429
        ? (retryAfter(rpcName) ?? Math.max(RATE_LIMIT_FLOOR_MS, rng() * bound))
        : rng() * bound;
    await persist((metadata) => {
      const entry = metadata.pending.find(
        (item) => item.mutationId === mutation.mutationId,
      );
      if (entry)
        Object.assign(entry, {
          attempts: attempts + 1,
          nextAttemptAt: new Date(clock() + wait).toISOString(),
          lastError: String(code || "network"),
        });
      return metadata;
    });
    stopTimer();
    backoff = timers.setTimeout(() => {
      backoff = null;
      enqueue("push", "pull");
    }, wait);
    await status(
      code === 0 && !navigatorRef.onLine
        ? null
        : attempts && bound === BACKOFF_MAX_MS
          ? "server"
          : null,
      code === 0 && !navigatorRef.onLine
        ? "offline"
        : attempts && bound === BACKOFF_MAX_MS
          ? "failed"
          : "pending",
    );
  };
  const makeConflict = (metadata, id, local, remote, reason, baseRev) => {
    if (metadata.conflicts[id]) return;
    const { kind, key } = storage.resourceParts(id);
    metadata.conflicts[id] = {
      id: dependencies.uuid?.() || crypto.randomUUID(),
      kind,
      key,
      reason,
      detectedAt: new Date(clock()).toISOString(),
      base: { rev: baseRev || 0 },
      local: {
        payload: local?.payload || null,
        deleted: !local,
        changedAt: new Date(clock()).toISOString(),
      },
      remote: {
        kind: remote.kind,
        key: remote.key,
        rev: remote.rev,
        seq: remote.seq,
        deleted: remote.deleted,
        payloadVersion: remote.payload_version,
        payload: remote.payload,
        createdAt: remote.created_at,
        updatedAt: remote.updated_at,
        deletedAt: remote.deleted_at,
        updatedBy: remote.updated_by,
      },
      resolution: null,
    };
    metadata.conflicts = sortedConflicts(metadata.conflicts);
  };
  const reduceEnvelope = (state, metadata, envelope) => {
    if (!validEnvelope(envelope)) throw new Error("malformed-response");
    const id = envelopeId(envelope);
    if (isOldDay(id)) return;
    const base = metadata.base[id];
    if (base && envelope.rev <= base.rev) return;
    if (metadata.conflicts[id]) return;
    if (!envelope.deleted && envelope.payload_version > payloadVersion) {
      metadata.quarantined = [...new Set([...metadata.quarantined, id])];
      metadata.quarantineVersions[id] = envelope.payload_version;
      return;
    }
    metadata.quarantined = metadata.quarantined.filter((entry) => entry !== id);
    delete metadata.quarantineVersions[id];
    if (storage.isResourceHeld(id)) {
      metadata.staging[id] = clone(envelope);
      return;
    }
    const local =
      id === "settings"
        ? storage.canonicalResource("settings", state.settings)
        : state.days[envelope.key]
          ? storage.canonicalResource("day", state.days[envelope.key])
          : null;
    const pendingIndex = metadata.pending.findIndex(
      (entry) => storage.resourceId(entry.kind, entry.key) === id,
    );
    const pending = pendingIndex < 0 ? null : metadata.pending[pendingIndex];
    const remote = envelope.deleted
      ? null
      : storage.normalizeRemotePayload(
          envelope.kind,
          envelope.payload,
          state.settings,
        );
    const clean =
      !pending &&
      (!base || (local && !base.deleted && local.hash === base.hash));
    const same =
      !envelope.deleted && local && local.canonical === remote.canonical;
    if (clean || same || (pending?.op === "delete" && envelope.deleted)) {
      if (envelope.deleted) delete state.days[envelope.key];
      else if (id === "settings") state.settings = remote.payload;
      else state.days[envelope.key] = remote.payload;
      metadata.base[id] = baseFor(envelope, remote);
      if (pendingIndex >= 0) metadata.pending.splice(pendingIndex, 1);
      return;
    }
    const reason = envelope.deleted
      ? "update/delete"
      : pending?.op === "delete"
        ? "delete/update"
        : "update/update";
    makeConflict(
      metadata,
      id,
      local,
      envelope,
      reason,
      pending?.expectedRev || base?.rev,
    );
    if (pendingIndex >= 0) metadata.pending.splice(pendingIndex, 1);
  };
  const pull = async () => {
    let read = await storage.getSyncMetadata();
    if (read.status !== "valid") return;
    let metadata = read.metadata;
    let since = metadata.cursor;
    if (
      Object.values(metadata.quarantineVersions || {}).some(
        (version) => version <= payloadVersion,
      )
    )
      since = 0;
    for (;;) {
      const client = auth.getAuthenticatedSupabase();
      if (!client) return status();
      await status(null, "syncing");
      const controller = new AbortController();
      abort = controller;
      const { data, error } = await client
        .rpc("sync_pull", {
          p_protocol: protocolVersion,
          p_since_seq: since,
          p_limit: PULL_PAGE_DEFAULT,
        })
        .abortSignal(controller.signal);
      abort = null;
      if (error) return handleTransport(error, null, "sync_pull");
      if (data?.result === "unsupported_protocol") {
        await persist((next) => ({
          ...next,
          halt: {
            reason: "unsupported_protocol",
            protocol: protocolVersion,
            detail: "update-required",
          },
        }));
        return status("update-required", "failed");
      }
      if (
        !data ||
        data.result !== "page" ||
        !Array.isArray(data.rows) ||
        !Number.isInteger(data.next_seq) ||
        typeof data.has_more !== "boolean"
      ) {
        await persist((next) => ({
          ...next,
          halt: {
            reason: "malformed_response",
            protocol: protocolVersion,
            detail: "malformed-response",
          },
        }));
        return status("malformed-response", "failed");
      }
      const state = await storage.getLocalState();
      if (!state) return;
      metadata = (await storage.getSyncMetadata()).metadata;
      try {
        for (const envelope of [...data.rows].sort((a, b) => a.seq - b.seq))
          reduceEnvelope(state, metadata, envelope);
      } catch {
        await persist((next) => ({
          ...next,
          halt: {
            reason: "malformed_response",
            protocol: protocolVersion,
            detail: "malformed-response",
          },
        }));
        return status("malformed-response", "failed");
      }
      metadata.cursor = data.next_seq;
      metadata.lastSyncedAt =
        data.server_time || new Date(clock()).toISOString();
      const committed = await storage.commitRemoteState({
        state,
        metadata,
        origin: "remote",
      });
      if (!committed.metadataSaved) return;
      since = data.next_seq;
      if (!data.has_more) break;
    }
  };
  const handleTransport = async (error, mutation, rpcName, retried = false) => {
    const statusCode = error?.status || 0;
    const code = error?.code;
    if (
      (statusCode === 401 || ["PGRST301", "PGRST303"].includes(code)) &&
      !retried
    ) {
      const refreshed = await auth.refreshAuthSession();
      if (refreshed?.status === "signed_in") return true;
      return status(null, "auth_required");
    }
    if (statusCode === 403 || code === "42501") {
      await persist((metadata) => ({
        ...metadata,
        halt: {
          reason: "forbidden",
          protocol: protocolVersion,
          detail: "forbidden",
        },
      }));
      return status("forbidden", "failed");
    }
    if (mutation) return pause(mutation, error, rpcName);
    return status(null, !navigatorRef.onLine ? "offline" : "pending");
  };
  const push = async () => {
    for (;;) {
      const read = await storage.getSyncMetadata();
      if (read.status !== "valid" || !read.metadata.pending.length) return;
      const candidate = read.metadata.pending[0];
      const id = storage.resourceId(candidate.kind, candidate.key);
      if (isOldDay(id)) {
        await persist((metadata) => {
          metadata.pending = metadata.pending.filter(
            (entry) => storage.resourceId(entry.kind, entry.key) !== id,
          );
          delete metadata.base[id];
          return metadata;
        });
        continue;
      }
      const prepared = await storage.preparePendingMutation(id);
      if (!prepared) return;
      const { mutation, payload } = prepared;
      const client = auth.getAuthenticatedSupabase();
      if (!client) return status();
      await status(null, "syncing");
      const args = {
        p_protocol: protocolVersion,
        p_mutation_id: mutation.mutationId,
        p_device_id: read.metadata.device.deviceId,
        p_kind: mutation.kind,
        p_key: mutation.key,
        p_expected_rev: mutation.expectedRev,
      };
      const name = mutation.op === "write" ? "sync_write" : "sync_delete";
      if (mutation.op === "write")
        Object.assign(args, {
          p_payload_version: mutation.payloadVersion,
          p_payload: payload,
        });
      const controller = new AbortController();
      abort = controller;
      let response = await client
        .rpc(name, args)
        .abortSignal(controller.signal);
      abort = null;
      if (
        response.error &&
        (response.error.status === 401 ||
          ["PGRST301", "PGRST303"].includes(response.error.code))
      ) {
        const refreshed = await auth.refreshAuthSession();
        if (refreshed?.status === "signed_in")
          response = await client.rpc(name, args);
      }
      if (response.error)
        return handleTransport(response.error, mutation, name, true);
      const data = response.data;
      if (!data || typeof data.result !== "string") {
        await persist((metadata) => ({
          ...metadata,
          halt: {
            reason: "malformed_response",
            protocol: protocolVersion,
            detail: "malformed-response",
          },
        }));
        return status("malformed-response", "failed");
      }
      const state = await storage.getLocalState();
      const metadata = (await storage.getSyncMetadata()).metadata;
      const index = metadata.pending.findIndex(
        (entry) => entry.mutationId === mutation.mutationId,
      );
      if (index < 0 || !state) continue;
      if (["applied", "already_deleted"].includes(data.result)) {
        reduceEnvelope(state, metadata, data.resource);
      } else if (data.result === "duplicate") {
        const acknowledged =
          mutation.op === "write"
            ? storage.canonicalResource(mutation.kind, mutation.sentPayload)
            : null;
        metadata.base[id] = {
          rev: data.applied_rev,
          seq: data.resource?.seq || 0,
          hash: acknowledged?.hash || null,
          deleted: mutation.op === "delete",
          payloadVersion: acknowledged ? payloadVersion : null,
        };
        metadata.pending.splice(index, 1);
        if (data.resource?.rev > data.applied_rev)
          reduceEnvelope(state, metadata, data.resource);
      } else if (data.result === "stale")
        reduceEnvelope(state, metadata, data.current);
      else if (data.result === "deleted") {
        makeConflict(
          metadata,
          id,
          mutation.op === "write"
            ? storage.canonicalResource(mutation.kind, mutation.sentPayload)
            : null,
          data.current,
          "local-vs-tombstone",
          mutation.expectedRev,
        );
        metadata.pending.splice(index, 1);
      } else if (data.result === "absent" && !mutation.recreatedOnce) {
        const current =
          id === "settings"
            ? storage.canonicalResource("settings", state.settings)
            : state.days[mutation.key]
              ? storage.canonicalResource("day", state.days[mutation.key])
              : null;
        delete metadata.base[id];
        metadata.pending[index] = {
          ...storage.createPendingMutation(id, current, null),
          recreatedOnce: true,
        };
      } else if (
        data.result === "absent" ||
        data.result === "invalid" ||
        data.result === "too_large"
      ) {
        metadata.pending.splice(index, 1);
        metadata.rejected[id] = {
          op: mutation.op,
          payloadHash: mutation.payloadHash,
          reason: data.result === "absent" ? "absent" : data.result,
          detail: data.detail || null,
        };
      } else if (data.result === "expired") {
        metadata.pending.splice(index, 1);
        delete metadata.base[id];
      } else if (data.result === "unsupported_protocol") {
        metadata.halt = {
          reason: "unsupported_protocol",
          protocol: protocolVersion,
          detail: "update-required",
        };
      } else {
        metadata.halt = {
          reason: "malformed_response",
          protocol: protocolVersion,
          detail: "malformed-response",
        };
      }
      metadata.lastSyncedAt = data.server_time || metadata.lastSyncedAt;
      const committed = await storage.commitRemoteState({
        state,
        metadata,
        origin: "remote",
      });
      if (!committed.metadataSaved) return;
      if (metadata.halt || metadata.rejected[id])
        return status(metadata.halt?.detail || id, "failed");
    }
  };
  const run = async () => {
    if (running || !started || backoff) return;
    running = true;
    try {
      while (phases.length) {
        const read = await storage.getSyncMetadata();
        const metadata = read?.metadata;
        if (
          !metadata?.account ||
          metadata.needsReconcile ||
          metadata.halt ||
          auth.getAuthState?.().status !== "signed_in"
        ) {
          await status();
          break;
        }
        const phase = phases.shift();
        if (phase === "pull") await pull();
        else await push();
        const after = await storage.getSyncMetadata();
        if (after?.metadata?.halt || backoff) break;
      }
      await status();
    } finally {
      running = false;
      if (phases.length && !backoff) void run();
    }
  };
  const request = () => enqueue("pull", "push");
  const onStorage = (event) => {
    if (ownStatus) return;
    if (event.type === "status" && event.status === "pending") {
      if (debounce) timers.clearTimeout(debounce);
      debounce = timers.setTimeout(() => {
        debounce = null;
        enqueue("push", "pull");
      }, SAVE_DEBOUNCE_MS);
    } else if (event.type === "remote-pending") enqueue("pull", "push");
  };
  const onAuth = (state) => {
    if (state.status === "signed_in") request();
    else void status();
  };
  return {
    start() {
      if (started) return;
      started = true;
      unsubscribeStorage = storage.subscribe?.(onStorage) || null;
      unsubscribeAuth = auth.subscribeAuth?.(onAuth) || null;
      events.addEventListener?.("online", request);
      request();
    },
    stop() {
      started = false;
      phases = [];
      if (debounce) timers.clearTimeout(debounce);
      debounce = null;
      stopTimer();
      unsubscribeStorage?.();
      unsubscribeAuth?.();
      unsubscribeStorage = unsubscribeAuth = null;
      events.removeEventListener?.("online", request);
      abort?.abort();
      abort = null;
    },
    foreground: request,
    async now() {
      stopTimer();
      await persist((metadata) => ({
        ...metadata,
        halt:
          metadata.halt &&
          metadata.halt.reason === "unsupported_protocol" &&
          metadata.halt.protocol === protocolVersion
            ? metadata.halt
            : null,
      }));
      request();
      while (running || phases.length)
        await new Promise((resolve) => timers.setTimeout(resolve, 0));
    },
  };
}

const singleton = createSyncEngine();
export const startSync = () => singleton.start();
export const stopSync = () => singleton.stop();
export const syncOnForeground = () => singleton.foreground();
export const syncNow = () => singleton.now();
