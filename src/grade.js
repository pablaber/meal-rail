// Two drinks fill one circle — Canada's 2023 guidance says not to exceed two on
// any day, so a full circle is exactly the ceiling and one drink sits visibly
// half way there. Grading and every visual surface share this boundary.
export const DRINKS_PER_CIRCLE = 2;

// [1, 1, 0.5] for five drinks — whole circles first, the remainder last.
export function drinkCircles(n) {
  const out = [];
  for (let i = 0; i < Math.floor(n / DRINKS_PER_CIRCLE); i++) out.push(1);
  const rem = (n % DRINKS_PER_CIRCLE) / DRINKS_PER_CIRCLE;
  if (rem > 0) out.push(rem);
  return out;
}

// A finished day gets graded on what it ended up looking like. An unplanned
// entry is one negative; drinks are one negative per circle started.
export function dayBadge({ planned, checks, extra, drinks }) {
  if (checks === 0 && extra === 0 && drinks === 0) return null;
  const negatives = extra + Math.ceil(drinks / DRINKS_PER_CIRCLE);
  if (negatives >= 3) return "terrible";
  if (negatives === 2) return "bad";
  if (checks === 0) return "empty";
  if (negatives === 1) return "silver";
  return checks >= planned ? "gold" : "green";
}

// The grading inputs for one record, without a date attached. Workouts count as
// both checked and planned entries; unplanned snacks and drinks do not.
export function summarize(r, defaultPlanned) {
  return {
    planned: r?.planned ?? defaultPlanned,
    checks: r
      ? Object.keys(r.checks || {}).length + (r.workouts || []).length
      : 0,
    extra: r ? (r.unplanned || []).length : 0,
    drinks: r?.drinks || 0,
  };
}

export function daySummary(days, key, defaultPlanned, isToday) {
  const entry = { key, ...summarize(days[key], defaultPlanned), isToday };
  return { ...entry, badge: isToday ? null : dayBadge(entry) };
}

// A hollow record is removed instead of being persisted.
export function isEmptyDay(r) {
  return (
    !Object.keys(r.checks || {}).length &&
    !(r.unplanned || []).length &&
    !(r.workouts || []).length &&
    !(r.drinks || 0)
  );
}

// What a day is measured against before workouts are added on top.
export function plannedBase(r, slots) {
  return typeof r?.planned === "number"
    ? Math.max(0, r.planned - (r.workouts || []).length)
    : slots.length;
}
