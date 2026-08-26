import assert from "node:assert/strict";
import test from "node:test";

import {
  createSyncEngine,
  PULL_PAGE_DEFAULT,
  PROTOCOL_VERSION,
} from "../src/sync.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

function builder(response) {
  return { abortSignal: async () => response };
}

function metadata() {
  return {
    device: {
      deviceId: "device",
      label: "Test",
      platform: "test",
      firstSeenAt: "2026-08-25T00:00:00.000Z",
      lastSeenAt: "2026-08-25T00:00:00.000Z",
    },
    account: { userId: "user" },
    needsReconcile: false,
    cursor: 0,
    base: {},
    pending: [],
    conflicts: {},
    staging: {},
    quarantined: [],
    rejected: {},
    halt: null,
    quarantineVersions: {},
    lastSyncedAt: null,
  };
}

function storageFixture() {
  let state = { settings: { plans: [] }, days: {} };
  let meta = metadata();
  const listeners = new Set();
  return {
    getLocalState: async () => clone(state),
    getSyncMetadata: async () => ({ status: "valid", metadata: clone(meta) }),
    updateSyncMetadata: async (updater) => {
      meta = updater(clone(meta));
      return true;
    },
    commitRemoteState: async (next) => {
      state = clone(next.state);
      meta = clone(next.metadata);
      return { localSaved: true, metadataSaved: true };
    },
    preparePendingMutation: async () => null,
    createPendingMutation() {
      throw new Error("not used");
    },
    canonicalResource(kind, payload) {
      const canonical = JSON.stringify(payload);
      return { payload, canonical, hash: canonical };
    },
    normalizeRemotePayload(kind, payload) {
      const canonical = JSON.stringify(payload);
      return { payload, canonical, hash: canonical };
    },
    resourceId: (kind, key) =>
      kind === "settings" ? "settings" : `day:${key}`,
    resourceParts: (id) =>
      id === "settings"
        ? { kind: "settings", key: "settings" }
        : { kind: "day", key: id.slice(4) },
    isResourceHeld: () => false,
    emitSyncEvent(event) {
      for (const listener of listeners) listener(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => ({ state, meta }),
  };
}

test("startup pulls a remote day and commits its cursor", async () => {
  const storage = storageFixture();
  const calls = [];
  const auth = {
    getAuthState: () => ({ status: "signed_in" }),
    getAuthenticatedSupabase: () => ({
      rpc(name, args) {
        calls.push({ name, args });
        return builder({
          data: {
            result: "page",
            rows: [
              {
                kind: "day",
                key: "2026-08-25",
                rev: 1,
                seq: 1,
                deleted: false,
                payload_version: 1,
                payload: { planned: 2 },
              },
            ],
            next_seq: 1,
            has_more: false,
            server_time: "2026-08-25T00:00:00.000Z",
          },
          error: null,
        });
      },
    }),
    refreshAuthSession: async () => ({ status: "signed_in" }),
    subscribeAuth: () => () => {},
  };
  const engine = createSyncEngine({
    storage,
    auth,
    navigator: { onLine: true },
    events: new globalThis.EventTarget(),
  });
  engine.start();
  await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
  engine.stop();
  assert.deepEqual(calls[0], {
    name: "sync_pull",
    args: {
      p_protocol: PROTOCOL_VERSION,
      p_since_seq: 0,
      p_limit: PULL_PAGE_DEFAULT,
    },
  });
  assert.deepEqual(storage.snapshot().state.days["2026-08-25"], { planned: 2 });
  assert.equal(storage.snapshot().meta.cursor, 1);
  assert.equal(storage.snapshot().meta.base["day:2026-08-25"].rev, 1);
});
