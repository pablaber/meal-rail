import { useMemo } from "react";
import { drinkCircles } from "../grade.js";
import { C, FONT } from "../theme.js";
import { DRINK_DOTS_MAX, DrinkDot } from "./HistoryStrip.jsx";

const WORKOUT_LABEL = "Workout Snack";
const SNACK_LABEL = "Snack";
const BUBBLE_EDGE = "1px solid transparent";
const ROW_CLASS =
  "row flex w-full items-center gap-4 rounded-xl px-2 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white";
const ROW_NODE_CLASS =
  "node relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full";
const ROW_TIME_CLASS = "text-xs";

const clock = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

// The rail and the two rows of controls under it: everything you do to a day,
// whichever day it is. Today writes through it on every tap; the past-day
// editor points it at a draft. Neither knows which, which is the point — the
// screen that wraps it decides where a patch lands.
export function DayRail({
  record,
  slots,
  trainingEnabled,
  onCheck,
  onAddSnack,
  onAddWorkout,
  onAddDrink,
  onEdit,
}) {
  const checks = record.checks || {};
  const notes = record.notes || {};
  const workouts = record.workouts || [];
  const drinks = record.drinks || 0;

  // Place each off-slot entry after however many meals were already checked when
  // it happened. Snacks and workouts share the rail, so they are positioned
  // together and then ordered by clock within a position.
  const extrasAt = useMemo(() => {
    const map = {};
    [
      ...(record.unplanned || []).map((e) => ({ kind: "unplanned", e })),
      ...(record.workouts || []).map((e) => ({ kind: "workout", e })),
    ].forEach((item) => {
      let pos = 0;
      slots.forEach((s) => {
        const t = (record.checks || {})[s.id];
        if (t && t <= item.e.t) pos += 1;
      });
      (map[pos] = map[pos] || []).push(item);
    });
    Object.values(map).forEach((list) =>
      list.sort((a, b) => a.e.t.localeCompare(b.e.t)),
    );
    return map;
  }, [record, slots]);

  return (
    <section className="relative mt-6">
      <div className="relative">
        {/* vertical line */}
        <div
          className="absolute left-[19.5px] top-3 bottom-3 w-px"
          style={{ background: C.rail }}
          aria-hidden="true"
        />

        <ul className="flex flex-col gap-1">
          <ExtraRows items={extrasAt[0]} onEdit={onEdit} />
          {slots.map((s, i) => {
            const t = checks[s.id];
            const note = notes[s.id];
            return (
              // The extras that follow a meal live inside its <li>, so the
              // list's own gap can't reach them — it repeats here, and every
              // row on the rail ends up the same distance apart.
              <li key={s.id} className="flex flex-col gap-1">
                <button
                  // A checked row opens the editor rather than clearing
                  // itself — undoing a meal shouldn't be one stray tap away.
                  onClick={() =>
                    t
                      ? onEdit({ kind: "slot", id: s.id, label: s.label })
                      : onCheck(s, i)
                  }
                  aria-pressed={!!t}
                  aria-label={t ? `Edit ${s.label}` : `Check off ${s.label}`}
                  // Checking a meal off is a tap that writes; opening the
                  // editor on one already checked is not.
                  data-haptic={t ? undefined : "commit"}
                  className={ROW_CLASS}
                  style={{ background: t ? C.surface : "transparent" }}
                >
                  <span
                    className={ROW_NODE_CLASS}
                    style={{
                      background: t ? C.done : C.ground,
                      border: `1px solid ${t ? C.done : C.faint}`,
                      transform: t ? "scale(1)" : "scale(0.82)",
                    }}
                  >
                    {t && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        aria-hidden="true"
                      >
                        <path
                          d="M2.5 6.3 L4.8 8.6 L9.5 3.6"
                          fill="none"
                          stroke={C.ground}
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block text-lg"
                      style={{
                        fontFamily: FONT.display,
                        color: t ? C.chalk : C.muted,
                      }}
                    >
                      {s.label}
                    </span>
                    {note && (
                      <span
                        className="block truncate text-xs"
                        style={{ color: C.muted }}
                      >
                        {note}
                      </span>
                    )}
                  </span>
                  <span
                    className={`${ROW_TIME_CLASS}${t ? " pr-1" : ""}`}
                    style={{
                      color: t ? C.done : C.rail,
                      fontFamily: FONT.mono,
                    }}
                  >
                    {t ? clock(t) : "—"}
                  </span>
                </button>

                <ExtraRows items={extrasAt[i + 1]} onEdit={onEdit} />
              </li>
            );
          })}
        </ul>
      </div>

      {/* The two things a day picks up off-plan, side by side and equally
          weighted — the rail above is what was planned, this row is what
          wasn't. Neither is wide enough for a sentence, hence the glyph.
          No left inset: the row spans the full width, so anything on one
          side only would take its seam off the centre line and out of step
          with the drinks row below. */}
      <div className="mt-4 flex items-stretch gap-2">
        <AddButton onClick={onAddSnack} color={C.brass} label={SNACK_LABEL} />
        {trainingEnabled && (
          <AddButton
            onClick={onAddWorkout}
            color={C.done}
            label={WORKOUT_LABEL}
            done={workouts.length > 0}
          />
        )}
      </div>

      {/* Tapping the pill only ever adds. The count beside it is the one way
          down again, so a stray tap can't undo a night's worth of counting.

          Two half-width tracks that meet in the middle, the near one packed
          right and the far one packed left. Centring the pair instead would
          put the seam wherever the count's width happened to leave it; this
          way the gap lands on the centre line and stays there as the count
          grows, in the same place as the gap in the row above. */}
      <div className="mt-3 flex items-center gap-2">
        <div className="flex flex-1 justify-end">
          {/* Sized rather than grown: filling its half would leave the seam
              correct but the button far wider than the count beside it. */}
          <AddButton
            onClick={onAddDrink}
            color={C.red}
            label="Drink"
            grow={false}
            width="9.5rem"
          />
        </div>
        <div className="flex flex-1 justify-start">
          {drinks > 0 ? (
            <button
              onClick={() =>
                onEdit({ kind: "drinks", id: "drinks", label: "Drinks" })
              }
              aria-label={`Edit drinks — ${drinks} logged`}
              className="flex items-center gap-2 rounded-full px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ background: C.surface, border: BUBBLE_EDGE }}
            >
              <span className="flex items-center gap-[3px]" aria-hidden="true">
                {drinkCircles(drinks)
                  .slice(0, DRINK_DOTS_MAX)
                  .map((fill, i) => (
                    <DrinkDot key={i} size={10} fill={fill} />
                  ))}
              </span>
              <span style={{ color: C.chalk, fontFamily: FONT.mono }}>
                {drinks}
              </span>
            </button>
          ) : (
            // Not a control — there is nothing to edit about none — so it is a
            // plain bubble holding the standing answer to what the button asks.
            <span
              role="img"
              aria-label="No drinks logged"
              className="flex items-center gap-2 rounded-full px-3 py-2 text-base"
              style={{ background: C.surface, border: BUBBLE_EDGE }}
            >
              <span
                className="flex h-4 w-4 items-center justify-center rounded-full"
                style={{ background: C.done }}
                aria-hidden="true"
              >
                <svg width="10" height="10" viewBox="0 0 12 12">
                  <path
                    d="M2.5 6.3 L4.8 8.6 L9.5 3.6"
                    fill="none"
                    stroke={C.ground}
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span
                aria-hidden="true"
                style={{ color: C.chalk, fontFamily: FONT.mono }}
              >
                None
              </span>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

// The dashed outline is the shared shape of "add something to today"; the colour
// is the only thing that says which something, and it matches the mark the entry
// leaves on the rail.
// `done` is for the one-a-day button once the day has had its one: the slot
// keeps its width so the row doesn't reflow, and dims to the rail colour with a
// tick in place of the plus rather than disappearing.
function AddButton({
  onClick,
  color,
  label,
  grow = true,
  width,
  done = false,
}) {
  const tone = done ? C.rail : color;
  return (
    <button
      onClick={onClick}
      disabled={done}
      data-haptic="commit"
      className={`flex ${grow ? "flex-1" : ""} items-center justify-center gap-2 rounded-full px-4 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white`}
      style={{
        background: "transparent",
        color: tone,
        border: `1px dashed ${tone}`,
        width,
      }}
    >
      {done ? <IconTick color={tone} /> : <IconPlus color={tone} />}
      {label}
    </button>
  );
}

function IconPlus({ color }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7 1.5v11M1.5 7h11"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconTick({ color }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 7.5 L5.5 11 L12 3.5"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Snacks and workouts both sit between the meals rather than among them, so they
// are drawn from one list and keep the rail in clock order.
function ExtraRows({ items, onEdit }) {
  return (items || []).map(({ kind, e }) =>
    kind === "workout" ? (
      <WorkoutRow key={e.id} w={e} onEdit={onEdit} />
    ) : (
      <UnplannedRow key={e.id} u={e} onEdit={onEdit} />
    ),
  );
}
// Drawn as a checked meal, because that is what it is: a slot the day earned and
// filled in the same motion. The only tell is that it can be removed rather than
// unchecked.
function WorkoutRow({ w, onEdit }) {
  return (
    <button
      onClick={() =>
        onEdit({ kind: "workout", id: w.id, label: WORKOUT_LABEL })
      }
      aria-label={`Edit this ${WORKOUT_LABEL.toLowerCase()}`}
      className={ROW_CLASS}
      style={{ background: C.surface }}
    >
      <span
        className={ROW_NODE_CLASS}
        style={{
          background: C.done,
          border: `1px solid ${C.done}`,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2.5 6.3 L4.8 8.6 L9.5 3.6"
            fill="none"
            stroke={C.ground}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block text-lg"
          style={{ fontFamily: FONT.display, color: C.chalk }}
        >
          {WORKOUT_LABEL}
        </span>
        {w.note && (
          <span className="block truncate text-xs" style={{ color: C.muted }}>
            {w.note}
          </span>
        )}
      </span>
      <span
        className={`${ROW_TIME_CLASS} pr-1`}
        style={{
          color: C.done,
          fontFamily: FONT.mono,
        }}
      >
        {clock(w.t)}
      </span>
    </button>
  );
}

// Built to the same pattern as a meal row — filled node, fill behind it, one
// label and a time — and left to colour alone to say it wasn't on the plan. The
// glyph is a bar rather than a tick because a snack isn't an achievement; it's
// the neutral mark between the meals that earn one and the drinks that cost one.
function UnplannedRow({ u, onEdit }) {
  return (
    <button
      onClick={() =>
        onEdit({ kind: "unplanned", id: u.id, label: SNACK_LABEL })
      }
      aria-label={`Edit this ${SNACK_LABEL.toLowerCase()}`}
      className={ROW_CLASS}
      style={{ background: C.surfaceBrass }}
    >
      <span
        className={ROW_NODE_CLASS}
        style={{
          background: C.brass,
          border: `1px solid ${C.brass}`,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M3 6 L9 6"
            fill="none"
            stroke={C.ground}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block text-lg"
          style={{ fontFamily: FONT.display, color: C.brass }}
        >
          {SNACK_LABEL}
        </span>
        {u.note && (
          <span className="block truncate text-xs" style={{ color: C.muted }}>
            {u.note}
          </span>
        )}
      </span>
      <span
        className={ROW_TIME_CLASS}
        style={{
          color: C.brass,
          fontFamily: FONT.mono,
        }}
      >
        {clock(u.t)}
      </span>
    </button>
  );
}
