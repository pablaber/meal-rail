// Place off-slot entries around the fixed meal-plan order. An extra belongs
// after every planned meal that was checked before it, so its position is the
// furthest such slot in the plan — not the number of earlier checks. Those two
// differ when planned meals are logged out of order.
export function extrasByPosition(record, slots) {
  const map = {};
  const checks = record.checks || {};
  const extras = [
    ...(record.unplanned || []).map((entry) => ({
      kind: "unplanned",
      e: entry,
    })),
    ...(record.workouts || []).map((entry) => ({
      kind: "workout",
      e: entry,
    })),
  ];

  extras.forEach((item) => {
    let position = 0;
    slots.forEach((slot, index) => {
      const checkedAt = checks[slot.id];
      if (checkedAt && checkedAt <= item.e.t) position = index + 1;
    });
    (map[position] = map[position] || []).push(item);
  });

  Object.values(map).forEach((items) =>
    items.sort((a, b) => a.e.t.localeCompare(b.e.t)),
  );
  return map;
}
