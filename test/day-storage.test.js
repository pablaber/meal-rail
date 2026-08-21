import test from "node:test";
import assert from "node:assert/strict";

import { dateAt, dayKey, shiftDay, stampOn, trimDays } from "../src/day.js";
import { importFile, importText, summarizeBackup } from "../src/storage.js";

test("day keys use local dates instead of parsing date-only strings as UTC", () => {
  const date = dateAt("2026-01-02");
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 0);
  assert.equal(date.getDate(), 2);
  assert.equal(date.getHours(), 0);
  assert.equal(dayKey(date), "2026-01-02");
});

test("day shifts cross month, year, leap-day, and daylight-saving boundaries", () => {
  assert.equal(shiftDay("2025-12-31", 1), "2026-01-01");
  assert.equal(shiftDay("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftDay("2024-02-28", 1), "2024-02-29");
  assert.equal(shiftDay("2024-02-29", 1), "2024-03-01");
  assert.equal(shiftDay("2026-03-07", 2), "2026-03-09");
});

test("backfilled timestamps stay on the selected local day", () => {
  const stamped = new Date(stampOn("2026-01-02", "17:30"));
  assert.equal(dayKey(stamped), "2026-01-02");
  assert.equal(stamped.getHours(), 17);
  assert.equal(stamped.getMinutes(), 30);
});

test("retention keeps the 400-day cutoff and removes the day before it", () => {
  const days = {
    "2025-07-06": { checks: { a: "stamp" } },
    "2025-07-07": { checks: { a: "stamp" } },
    "2026-08-11": { checks: { a: "stamp" } },
    "2026-08-12": { checks: { future: "stamp" } },
  };

  assert.deepEqual(trimDays(days, "2026-08-11"), {
    "2025-07-07": days["2025-07-07"],
    "2026-08-11": days["2026-08-11"],
    "2026-08-12": days["2026-08-12"],
  });
});

test("checked legacy training entries migrate to workouts without changing planned", () => {
  const migrated = importText(
    JSON.stringify({
      settings: {},
      days: {
        "2026-08-10": {
          training: true,
          planned: 4,
          checks: { breakfast: "meal", __training: "workout" },
          notes: { breakfast: "eggs", __training: "shake" },
        },
      },
    }),
  ).days["2026-08-10"];

  assert.deepEqual(migrated, {
    planned: 4,
    checks: { breakfast: "meal" },
    notes: { breakfast: "eggs" },
    workouts: [{ id: "wworkout", t: "workout", note: "shake" }],
  });
});

test("unchecked legacy training entries return their planned slot", () => {
  assert.deepEqual(
    importText(
      JSON.stringify({
        settings: {},
        days: {
          "2026-08-10": {
            training: true,
            planned: 4,
            checks: {},
            notes: {},
          },
        },
      }),
    ).days["2026-08-10"],
    { planned: 3, checks: {} },
  );
});

test("backup parsing validates shape and applies all legacy migrations", () => {
  assert.throws(() => importText("not json"), /isn't valid JSON/);
  assert.throws(() => importText("null"), /top level must be an object/);
  assert.throws(() => importText('{"settings":{}}'), /days must be an object/);

  const parsed = importText(
    JSON.stringify({
      settings: { promptSnackNotes: true },
      days: {
        "2026-08-10": { training: true, planned: 4, checks: {} },
      },
    }),
  );
  assert.deepEqual(parsed.settings, {
    promptNotes: true,
    plans: [
      {
        from: "2026-08-10",
        slots: [
          { id: "s1", label: "Breakfast" },
          { id: "s2", label: "Lunch" },
          { id: "s4", label: "Dinner" },
        ],
      },
    ],
  });
  assert.deepEqual(parsed.days["2026-08-10"], { planned: 3, checks: {} });
});

test("backup parsing rejects invalid nested structures with actionable paths", () => {
  const valid = {
    settings: {
      plans: [
        {
          from: "2026-08-01",
          slots: [{ id: "s1", label: "Breakfast" }],
        },
      ],
    },
    days: {
      "2026-08-01": {
        planned: 1,
        checks: { s1: "stamp" },
        unplanned: [],
      },
    },
  };

  assert.throws(
    () => importText(JSON.stringify({ ...valid, days: [] })),
    /days must be an object/,
  );
  assert.throws(
    () =>
      importText(
        JSON.stringify({
          ...valid,
          settings: { plans: [{ from: "August 1", slots: [] }] },
        }),
      ),
    /settings\.plans\[0\]\.from must be a YYYY-MM-DD date/,
  );
  assert.throws(
    () =>
      importText(
        JSON.stringify({
          ...valid,
          days: {
            "2026-08-01": { ...valid.days["2026-08-01"], drinks: -1 },
          },
        }),
      ),
    /days\.2026-08-01\.drinks must be a non-negative whole number/,
  );
  assert.throws(
    () =>
      importText(
        JSON.stringify({
          ...valid,
          days: {
            "2026-08-01": {
              ...valid.days["2026-08-01"],
              unplanned: [{ id: "snack", t: 123 }],
            },
          },
        }),
      ),
    /days\.2026-08-01\.unplanned\[0\]\.t must be a non-empty string/,
  );
});

test("backup summaries report their range and meaningful entry counts", () => {
  assert.deepEqual(
    summarizeBackup({
      settings: {},
      days: {
        "2026-08-03": {
          checks: { s1: "one", s2: "two" },
          unplanned: [{ id: "u1", t: "three" }],
          workouts: [{ id: "w1", t: "four" }],
          drinks: 2,
        },
        "2026-08-01": { checks: {}, unplanned: [], drinks: 1 },
      },
    }),
    {
      dayCount: 2,
      firstDay: "2026-08-01",
      lastDay: "2026-08-03",
      checks: 2,
      snacks: 1,
      workouts: 1,
      drinks: 3,
    },
  );
});

test("cancelling the backup file picker settles without an error", async (t) => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const inputListeners = new Map();
  const input = {
    files: [],
    addEventListener: (name, listener) => inputListeners.set(name, listener),
    click: () => inputListeners.get("cancel")(),
  };
  const fakeWindow = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  globalThis.document = { createElement: () => input };
  globalThis.window = fakeWindow;
  t.after(() => {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  });

  assert.equal(await importFile(), null);
});

test("dated and upcoming plans round-trip through backup parsing", () => {
  const state = {
    settings: {
      plans: [
        {
          from: "2026-08-10",
          slots: [{ id: "s1", label: "Breakfast" }],
        },
        {
          from: "2026-08-22",
          slots: [{ id: "s1", label: "Brunch" }],
        },
      ],
      promptNotes: false,
    },
    days: { "2026-08-21": { planned: 1, checks: { s1: "stamp" } } },
  };

  assert.deepEqual(importText(JSON.stringify(state)), state);
});
