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

// The fortnight the strip settings preview draws. It is made up, and it says so
// on screen: a real fortnight is whatever it happened to be, and a clean one
// shows none of the grades you are choosing between.
//
// It lives here rather than beside the screen that draws it because what makes
// it correct is a property of grading — every tier has to appear, or the
// preview quietly stops showing the thing being configured — and the test that
// holds that line needs to import it. The badges come from `dayBadge` for the
// same reason: a preview that graded its own days could lie about the rules.
//
// `bad` and `terrible` sit next to each other on purpose. They are the two the
// tinted date has the hardest time telling apart, so they belong side by side
// where the difference either reads or doesn't.
const SAMPLE_SEED = [
  { checks: 4, extra: 0, drinks: 0 }, // gold
  { checks: 3, extra: 0, drinks: 0 }, // green
  { checks: 4, extra: 1, drinks: 0 }, // silver
  { checks: 2, extra: 0, drinks: 0 }, // green
  { checks: 4, extra: 0, drinks: 0 }, // gold
  { checks: 0, extra: 0, drinks: 0 }, // nothing logged at all
  { checks: 3, extra: 2, drinks: 0 }, // bad
  { checks: 1, extra: 2, drinks: 2 }, // terrible
  { checks: 4, extra: 0, drinks: 0 }, // gold
  { checks: 0, extra: 1, drinks: 0 }, // empty
  { checks: 4, extra: 0, drinks: 2 }, // silver
  { checks: 3, extra: 1, drinks: 1 }, // bad
  { checks: 3, extra: 0, drinks: 0 }, // green
  { checks: 2, extra: 0, drinks: 0 }, // today, part way through
];

const SAMPLE_PLANNED = 4;

export const SAMPLE_FORTNIGHT = SAMPLE_SEED.map((s, i) => {
  const entry = {
    // A month that reads as a date without pretending to be one of yours.
    key: `2026-01-${String(i + 1).padStart(2, "0")}`,
    planned: SAMPLE_PLANNED,
    isToday: i === SAMPLE_SEED.length - 1,
    ...s,
  };
  return { ...entry, badge: entry.isToday ? null : dayBadge(entry) };
});

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
