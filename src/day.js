export const RETENTION_DAYS = 400;

export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Local midnight on a day key. Parsing YYYY-MM-DD directly would use UTC and
// can move the result to the previous local day.
export function dateAt(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function shiftDay(key, delta) {
  const dt = dateAt(key);
  dt.setDate(dt.getDate() + delta);
  return dayKey(dt);
}

export function formatDate(key) {
  return dateAt(key).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateShort(key) {
  return dateAt(key).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function dayHeadings(key, todayKey) {
  const year =
    key.slice(0, 4) === todayKey.slice(0, 4) ? {} : { year: "numeric" };
  const d = dateAt(key);
  return [
    d.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      ...year,
    }),
    d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...year,
    }),
  ];
}

export function stampOn(key, value) {
  const [hh, mm] = value.split(":").map(Number);
  const d = dateAt(key);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

export function trimDays(days, todayKey = dayKey()) {
  const cutoff = shiftDay(todayKey, -RETENTION_DAYS);
  return Object.fromEntries(
    Object.entries(days).filter(([key]) => key >= cutoff),
  );
}
