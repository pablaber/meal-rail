import test from "node:test";
import assert from "node:assert/strict";
import { extrasByPosition } from "../src/rail.js";

test("extras follow the furthest meal slot checked before them", () => {
  const slots = [
    { id: "breakfast", label: "Breakfast" },
    { id: "lunch", label: "Lunch" },
    { id: "dinner", label: "Dinner" },
  ];
  const workout = { id: "workout", t: "2026-08-23T18:57:00.000Z" };
  const record = {
    checks: {
      breakfast: "2026-08-23T23:16:00.000Z",
      lunch: "2026-08-23T15:30:00.000Z",
    },
    workouts: [workout],
  };

  const positions = extrasByPosition(record, slots);

  assert.deepEqual(positions[2], [{ kind: "workout", e: workout }]);
  assert.equal(positions[1], undefined);
});
