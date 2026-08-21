import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SLOTS,
  applyPlanChange,
  migratePlans,
  nextSlotId,
  planFor,
  removePlan,
  slotsFor,
  upsertPlan,
} from "../src/plans.js";

const breakfast = [{ id: "s1", label: "Breakfast" }];
const brunch = [{ id: "s1", label: "Brunch" }];
const dinner = [{ id: "s4", label: "Dinner" }];

test("plans resolve across transitions and fall back before the baseline", () => {
  const plans = [
    { from: "2026-08-10", slots: breakfast },
    { from: "2026-08-20", slots: brunch },
    { from: "2026-08-22", slots: dinner },
  ];

  assert.equal(planFor(plans, "2026-08-01").from, "2026-08-10");
  assert.deepEqual(slotsFor(plans, "2026-08-19"), breakfast);
  assert.deepEqual(slotsFor(plans, "2026-08-20"), brunch);
  assert.deepEqual(slotsFor(plans, "2026-08-21"), brunch);
  assert.deepEqual(slotsFor(plans, "2026-08-22"), dinner);
});

test("upserting a plan replaces the same date and keeps dates ordered", () => {
  const plans = upsertPlan(
    [
      { from: "2026-08-22", slots: dinner },
      { from: "2026-08-10", slots: breakfast },
    ],
    { from: "2026-08-22", slots: brunch },
  );

  assert.deepEqual(plans, [
    { from: "2026-08-10", slots: breakfast },
    { from: "2026-08-22", slots: brunch },
  ]);
  assert.deepEqual(removePlan(plans, "2026-08-22"), [plans[0]]);
});

test("new slot ids are higher than plan history and orphaned day checks", () => {
  const plans = [
    { from: "2026-08-10", slots: DEFAULT_SLOTS },
    { from: "2026-08-20", slots: breakfast },
  ];
  const days = { "2026-08-12": { checks: { s9: "stamp", custom: "stamp" } } };

  assert.equal(nextSlotId(plans, days), "s10");
});

test("legacy slots migrate from the earliest stored day without changing ids", () => {
  const settings = migratePlans(
    { slots: brunch, promptNotes: true },
    { "2026-08-12": {}, "2026-08-10": {} },
    "2026-08-21",
  );

  assert.deepEqual(settings, {
    promptNotes: true,
    plans: [{ from: "2026-08-10", slots: brunch }],
  });
});

test("legacy defaults begin today when there are no stored days", () => {
  assert.deepEqual(migratePlans({}, {}, "2026-08-21"), {
    plans: [{ from: "2026-08-21", slots: DEFAULT_SLOTS }],
  });
});

test("existing dated plans are preserved, sorted, and coalesced by date", () => {
  const settings = migratePlans(
    {
      slots: dinner,
      plans: [
        { from: "2026-08-22", slots: dinner },
        { from: "2026-08-10", slots: breakfast },
        { from: "2026-08-22", slots: brunch },
      ],
    },
    {},
    "2026-08-21",
  );

  assert.deepEqual(settings, {
    plans: [
      { from: "2026-08-10", slots: breakfast },
      { from: "2026-08-22", slots: brunch },
    ],
  });
});

test("starting tomorrow preserves today while starting now can erase it", () => {
  const plans = [{ from: "2026-08-10", slots: breakfast }];
  const days = {
    "2026-08-21": { checks: { s1: "breakfast" }, planned: 1 },
  };

  const tomorrow = applyPlanChange(plans, days, {
    from: "2026-08-22",
    slots: brunch,
  });
  assert.deepEqual(tomorrow.days, days);
  assert.deepEqual(tomorrow.plans.at(-1), {
    from: "2026-08-22",
    slots: brunch,
  });

  const today = applyPlanChange(plans, days, {
    from: "2026-08-21",
    slots: brunch,
    removeDay: "2026-08-21",
  });
  assert.deepEqual(today.days, {});
  assert.deepEqual(today.plans.at(-1), {
    from: "2026-08-21",
    slots: brunch,
  });
});
