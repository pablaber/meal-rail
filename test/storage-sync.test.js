import assert from "node:assert/strict";
import test from "node:test";

const originalStorage = globalThis.localStorage;

function storage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

async function fresh() {
  return import(`../src/storage.js?test=${Math.random()}`);
}

test("FNV-1a contract vectors and canonical normalization", async (t) => {
  globalThis.localStorage = storage();
  t.after(() => {
    globalThis.localStorage = originalStorage;
  });
  const { canonicalResource, fnv1a } = await fresh();
  assert.equal(fnv1a(""), "6c62272e07bb014262b821756295c58d");
  assert.equal(fnv1a("foo"), "a68d5ed15f8b5822836dbc79768d78bf");
  assert.equal(fnv1a("😀"), "6633bd7871757277b806e877951e7228");
  const resource = canonicalResource("day", {
    planned: 0,
    drinks: 0,
    checks: { s1: null },
    workouts: [],
    z: null,
    b: 1,
    a: 2,
  });
  assert.deepEqual(resource.payload, { a: 2, b: 1, planned: 0 });
  assert.equal(resource.canonical, '{"a":2,"b":1,"planned":0}');
});

test("local-only load leaves sync metadata absent", async (t) => {
  globalThis.localStorage = storage();
  t.after(() => {
    globalThis.localStorage = originalStorage;
  });
  globalThis.localStorage.setItem(
    "mealrail:v1",
    JSON.stringify({ settings: {}, days: {} }),
  );
  const { load, SYNC_META_KEY } = await fresh();
  const result = await load();
  assert.equal(result.status, "valid");
  assert.equal(globalThis.localStorage.getItem(SYNC_META_KEY), null);
});

test("same-tick saves coalesce to the final durable snapshot", async (t) => {
  globalThis.localStorage = storage();
  t.after(() => {
    globalThis.localStorage = originalStorage;
  });
  const { save } = await fresh();
  const first = save({
    settings: { plans: [] },
    days: { "2026-08-23": { planned: 1 } },
  });
  const second = save({
    settings: { plans: [] },
    days: { "2026-08-24": { planned: 2 } },
  });
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.deepEqual(
    JSON.parse(globalThis.localStorage.getItem("mealrail:v1")).days,
    {
      "2026-08-24": { planned: 2 },
    },
  );
});

test("a queued save cannot overwrite a following restore", async (t) => {
  globalThis.localStorage = storage();
  t.after(() => {
    globalThis.localStorage = originalStorage;
  });
  const { restore, save } = await fresh();
  const saved = save({ settings: { plans: [] }, days: {} });
  const restored = restore({
    settings: { plans: [] },
    days: { "2026-08-24": { planned: 2 } },
  });
  assert.equal(await saved, true);
  assert.equal(await restored, true);
  assert.deepEqual(
    JSON.parse(globalThis.localStorage.getItem("mealrail:v1")).days,
    { "2026-08-24": { planned: 2 } },
  );
});
