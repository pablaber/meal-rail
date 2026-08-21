export const DEFAULT_SLOTS = [
  { id: "s1", label: "Breakfast" },
  { id: "s2", label: "Lunch" },
  { id: "s4", label: "Dinner" },
];

const copySlots = (slots) => slots.map((slot) => ({ ...slot }));

export function upsertPlan(plans, plan) {
  const byDate = new Map(
    (Array.isArray(plans) ? plans : []).map((entry) => [entry.from, entry]),
  );
  byDate.set(plan.from, { ...plan, slots: copySlots(plan.slots) });
  return [...byDate.values()].sort((a, b) => a.from.localeCompare(b.from));
}

export function removePlan(plans, from) {
  return (Array.isArray(plans) ? plans : []).filter(
    (plan) => plan.from !== from,
  );
}

export function applyPlanChange(plans, days, { from, slots, removeDay }) {
  const nextDays = { ...(days || {}) };
  if (removeDay) delete nextDays[removeDay];
  return {
    plans: upsertPlan(plans, { from, slots }),
    days: nextDays,
  };
}

export function planFor(plans, key) {
  const ordered = (Array.isArray(plans) ? plans : [])
    .filter(
      (plan) =>
        plan && typeof plan.from === "string" && Array.isArray(plan.slots),
    )
    .sort((a, b) => a.from.localeCompare(b.from));
  if (!ordered.length) return { from: key, slots: DEFAULT_SLOTS };

  let active = null;
  for (const plan of ordered) {
    if (plan.from > key) break;
    active = plan;
  }
  // A migrated install starts at its earliest stored day. Blank dates before
  // then still need a useful rail when opened from the calendar.
  return active || ordered[0];
}

export function slotsFor(plans, key) {
  return planFor(plans, key).slots;
}

export function nextSlotId(plans, days = {}) {
  const used = new Set();
  let highest = 0;
  const remember = (id) => {
    used.add(id);
    const match = /^s(\d+)$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  };

  (Array.isArray(plans) ? plans : []).forEach((plan) =>
    (plan.slots || []).forEach((slot) => remember(slot.id)),
  );
  Object.values(days || {}).forEach((record) =>
    Object.keys(record?.checks || {}).forEach(remember),
  );

  let candidate;
  do {
    highest += 1;
    candidate = `s${highest}`;
  } while (used.has(candidate));
  return candidate;
}

export function migratePlans(settings, days, todayKey) {
  const next = { ...(settings || {}) };
  if (Array.isArray(next.plans) && next.plans.length) {
    next.plans = next.plans.reduce(
      (plans, plan) => upsertPlan(plans, plan),
      [],
    );
  } else {
    const keys = Object.keys(days || {}).sort();
    const slots =
      Array.isArray(next.slots) && next.slots.length
        ? next.slots
        : DEFAULT_SLOTS;
    next.plans = [
      {
        from: keys[0] || todayKey,
        slots: copySlots(slots),
      },
    ];
  }
  delete next.slots;
  return next;
}
