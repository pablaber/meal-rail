import test from "node:test";
import assert from "node:assert/strict";

import {
  dayBadge,
  daySummary,
  drinkCircles,
  isEmptyDay,
  plannedBase,
  summarize,
} from "../src/grade.js";

test("dayBadge covers every grading tier", () => {
  assert.equal(
    dayBadge({ planned: 3, checks: 3, extra: 0, drinks: 0 }),
    "gold",
  );
  assert.equal(
    dayBadge({ planned: 3, checks: 2, extra: 0, drinks: 0 }),
    "green",
  );
  assert.equal(
    dayBadge({ planned: 3, checks: 3, extra: 1, drinks: 0 }),
    "silver",
  );
  assert.equal(dayBadge({ planned: 3, checks: 3, extra: 2, drinks: 0 }), "bad");
  assert.equal(
    dayBadge({ planned: 3, checks: 3, extra: 3, drinks: 0 }),
    "terrible",
  );
  assert.equal(
    dayBadge({ planned: 3, checks: 0, extra: 1, drinks: 0 }),
    "empty",
  );
  assert.equal(dayBadge({ planned: 3, checks: 0, extra: 0, drinks: 0 }), null);
});

test("drink circles and grades change at two-drink boundaries", () => {
  assert.deepEqual(drinkCircles(0), []);
  assert.deepEqual(drinkCircles(1), [0.5]);
  assert.deepEqual(drinkCircles(2), [1]);
  assert.deepEqual(drinkCircles(3), [1, 0.5]);
  assert.deepEqual(drinkCircles(5), [1, 1, 0.5]);

  const grade = (drinks) =>
    dayBadge({ planned: 3, checks: 3, extra: 0, drinks });
  assert.equal(grade(1), "silver");
  assert.equal(grade(2), "silver");
  assert.equal(grade(3), "bad");
  assert.equal(grade(4), "bad");
  assert.equal(grade(5), "terrible");
});

test("workouts increase both the checked and planned counts", () => {
  const record = {
    checks: { breakfast: "2026-08-10T12:00:00.000Z" },
    workouts: [{ id: "w1", t: "2026-08-10T21:00:00.000Z" }],
    planned: 4,
  };

  assert.deepEqual(summarize(record, 3), {
    planned: 4,
    checks: 2,
    extra: 0,
    drinks: 0,
  });
  assert.equal(plannedBase(record, [{}, {}, {}]), 3);
  assert.equal(plannedBase(undefined, [{}, {}, {}]), 3);
  assert.equal(plannedBase({ planned: 0, workouts: [{}] }, []), 0);
});

test("daySummary withholds today's badge", () => {
  const days = {
    "2026-08-10": { checks: { a: "stamp" }, planned: 1 },
  };
  assert.equal(daySummary(days, "2026-08-10", 3, false).badge, "gold");
  assert.equal(daySummary(days, "2026-08-10", 3, true).badge, null);
});

test("isEmptyDay ignores hollow optional fields but detects every entry type", () => {
  assert.equal(isEmptyDay({}), true);
  assert.equal(
    isEmptyDay({
      checks: {},
      notes: { a: "orphaned" },
      unplanned: [],
      drinks: 0,
    }),
    true,
  );
  assert.equal(isEmptyDay({ checks: { a: "stamp" } }), false);
  assert.equal(isEmptyDay({ unplanned: [{}] }), false);
  assert.equal(isEmptyDay({ workouts: [{}] }), false);
  assert.equal(isEmptyDay({ drinks: 1 }), false);
});
