import { useMemo, useState } from "react";
import { daySummary } from "../grade.js";
import { dateAt, dayKey, formatDate } from "../day.js";
import { slotsFor } from "../plans.js";
import { C, FONT } from "../theme.js";
import { Screen } from "../components/Screen.jsx";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_SIZE = 34;

const BADGE_LABEL = {
  gold: "Perfect day",
  green: "Good day",
  silver: "Decent day",
  bad: "Bad day",
  terrible: "Terrible day",
  empty: "No meals logged",
};

const TIER = {
  gold: { background: C.gold, color: C.ground, glow: true },
  green: { background: C.done, color: C.ground },
  silver: { background: C.silver, color: C.ground },
  bad: { background: C.red, color: C.ground },
  terrible: {
    background: C.redDeep,
    color: C.chalk,
    border: `2px solid ${C.redDeepEdge}`,
  },
  empty: { background: C.rail, color: C.chalk },
};

export function CalendarScreen({ days, plans, today, onBack, onOpenDay }) {
  const currentMonth = useMemo(() => {
    const date = dateAt(today);
    return { year: date.getFullYear(), month: date.getMonth() };
  }, [today]);
  const [month, setMonth] = useState(currentMonth);

  const atCurrentMonth =
    month.year === currentMonth.year && month.month === currentMonth.month;

  const shiftMonth = (delta) =>
    setMonth(({ year, month: monthIndex }) => {
      const candidate = new Date(year, monthIndex + delta, 1);
      const ceiling = new Date(currentMonth.year, currentMonth.month, 1);
      const next = candidate > ceiling ? ceiling : candidate;
      return { year: next.getFullYear(), month: next.getMonth() };
    });

  const cells = useMemo(() => {
    const firstDow = new Date(month.year, month.month, 1).getDay();
    const daysInMonth = new Date(month.year, month.month + 1, 0).getDate();
    const result = Array(firstDow).fill(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const key = dayKey(new Date(month.year, month.month, day));
      result.push({
        day,
        ...daySummary(days, key, slotsFor(plans, key).length, key === today),
      });
    }
    return result;
  }, [days, month, plans, today]);

  const monthLabel = useMemo(
    () =>
      new Date(month.year, month.month, 1).toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      }),
    [month],
  );

  return (
    <Screen>
      <header className="flex items-start gap-3">
        <button
          onClick={onBack}
          aria-label="Back"
          className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{ background: C.surface }}
        >
          <IconBack color={C.chalk} />
        </button>
        <h1
          className="text-3xl leading-tight"
          style={{ fontFamily: FONT.display }}
        >
          Calendar
        </h1>
        {!atCurrentMonth && (
          <button
            onClick={() => setMonth(currentMonth)}
            aria-label="Jump to today"
            className="ml-auto mt-1 shrink-0 rounded-full px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{ background: C.surface, color: C.chalk }}
          >
            Today
          </button>
        )}
      </header>

      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <MonthButton label="Previous month" onClick={() => shiftMonth(-1)}>
            <IconChevron direction="left" color={C.chalk} />
          </MonthButton>
          <p className="text-lg" style={{ fontFamily: FONT.display }}>
            {monthLabel}
          </p>
          <MonthButton
            label="Next month"
            onClick={() => shiftMonth(1)}
            disabled={atCurrentMonth}
          >
            <IconChevron
              direction="right"
              color={atCurrentMonth ? C.faint : C.chalk}
            />
          </MonthButton>
        </div>

        <div className="mt-6 grid grid-cols-7 gap-y-2">
          {WEEKDAYS.map((weekday) => (
            <span
              key={weekday}
              className="mb-1 text-center text-[10px] uppercase tracking-widest"
              style={{ color: C.muted, fontFamily: FONT.mono }}
            >
              {weekday}
            </span>
          ))}
          {cells.map((cell, index) =>
            cell ? (
              <div key={cell.key} className="flex justify-center">
                {cell.key < today ? (
                  <button
                    onClick={() => onOpenDay(cell.key)}
                    aria-label={`Open ${formatDate(cell.key)}${
                      cell.badge ? `, ${BADGE_LABEL[cell.badge]}` : ", no grade"
                    }`}
                    className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <CalendarDay day={cell.day} tier={cell.badge} />
                  </button>
                ) : (
                  <CalendarDay
                    day={cell.day}
                    tier={cell.badge}
                    isToday={cell.isToday}
                  />
                )}
              </div>
            ) : (
              <div key={`blank-${index}`} aria-hidden="true" />
            ),
          )}
        </div>
      </section>
    </Screen>
  );
}

function MonthButton({ label, onClick, disabled = false, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      style={{ background: disabled ? "transparent" : C.surface }}
    >
      {children}
    </button>
  );
}

function CalendarDay({ day, tier, isToday }) {
  const style = tier ? TIER[tier] : null;
  const label = tier ? BADGE_LABEL[tier] : null;
  return (
    <span
      className="flex items-center justify-center rounded-full text-sm"
      role={label ? "img" : undefined}
      aria-label={label ? `${day}: ${label}` : undefined}
      title={label || undefined}
      style={{
        width: DAY_SIZE,
        height: DAY_SIZE,
        fontFamily: FONT.mono,
        background: style?.background || "transparent",
        color: style?.color || (isToday ? C.chalk : C.muted),
        boxShadow: style?.glow
          ? `0 0 ${DAY_SIZE / 3}px ${C.goldGlow}, inset 0 1px 0 ${C.sheen}`
          : undefined,
        border: style?.border || (isToday ? `1px solid ${C.muted}` : undefined),
      }}
    >
      {day}
    </span>
  );
}

function IconBack({ color }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M15 5l-7 7 7 7"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChevron({ direction, color }) {
  const path = direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7";
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={path}
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
