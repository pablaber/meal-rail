import test from "node:test";
import assert from "node:assert/strict";

import { dateAt, dayKey, shiftDay, stampOn, trimDays } from "../src/day.js";
import { importText } from "../src/storage.js";

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
  assert.throws(() => importText("null"), /isn't a Meal Rail backup/);
  assert.throws(
    () => importText('{"settings":{}}'),
    /isn't a Meal Rail backup/,
  );

  const parsed = importText(
    JSON.stringify({
      settings: { promptSnackNotes: true },
      days: {
        "2026-08-10": { training: true, planned: 4, checks: {} },
      },
    }),
  );
  assert.deepEqual(parsed.settings, { promptNotes: true });
  assert.deepEqual(parsed.days["2026-08-10"], { planned: 3, checks: {} });
});
