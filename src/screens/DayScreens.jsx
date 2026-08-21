import { useLayoutEffect, useRef, useState } from "react";
import { drinkCircles } from "../grade.js";
import { RETENTION_DAYS, dayHeadings, formatDate } from "../day.js";
import { C, FONT } from "../theme.js";
import { DayRail } from "../components/DayRail.jsx";
import {
  BADGE_LABEL,
  DRINK_DOTS_MAX,
  DayBadge,
  DrinkDot,
} from "../components/HistoryStrip.jsx";
import { Screen } from "../components/Screen.jsx";

const clock = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
const SNACK_LABEL = "Snack";
const WORKOUT_LABEL = "Workout Snack";

export function PastDay({
  dateKey,
  today,
  record,
  slots,
  summary,
  editable,
  onEdit,
  onBack,
  status,
}) {
  const checks = record?.checks || {};
  const notes = record?.notes || {};
  const snacks = record?.unplanned || [];
  const workouts = record?.workouts || [];
  const drinks = record?.drinks || 0;
  const grade = summary?.badge;

  return (
    <Screen>
      <header className="flex items-start gap-3">
        <button
          onClick={onBack}
          aria-label="Back to calendar"
          className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{ background: C.surface }}
        >
          <IconBack color={C.chalk} />
        </button>
        <div className="min-w-0 flex-1">
          <p
            className="text-xs uppercase tracking-widest"
            style={{ color: C.muted, fontFamily: FONT.mono }}
          >
            Past day
          </p>
          <FitHeading
            options={dayHeadings(dateKey, today)}
            max={30}
            min={20}
            className="mt-1 leading-tight"
            style={{ fontFamily: FONT.display }}
          />
        </div>
        {editable && (
          <button
            onClick={onEdit}
            aria-label={`Edit ${formatDate(dateKey)}`}
            className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{ background: C.surface }}
          >
            <IconPencil color={C.muted} />
          </button>
        )}
      </header>

      {/* A day past the retention window is about to be trimmed away, so
          offering to correct it would be offering to write into a bin. */}
      {!editable && (
        <p className="mt-4 text-sm" style={{ color: C.muted }}>
          Meal Rail keeps {RETENTION_DAYS} days. This one is older than that, so
          it can no longer be edited.
        </p>
      )}

      <GradeCard grade={grade} />

      <PastDaySection title="Meals">
        <div className="flex flex-col gap-2">
          {slots.map((slot) => (
            <PastEntry
              key={slot.id}
              label={slot.label}
              time={checks[slot.id]}
              note={notes[slot.id]}
              // Only the ring reads this when the meal wasn't checked — the
              // time falls back to `rail` on its own, and an em dash standing
              // in for a time it never had should stay a hairline.
              tone={checks[slot.id] ? C.done : C.faint}
              checked={!!checks[slot.id]}
            />
          ))}
        </div>
      </PastDaySection>

      <PastDaySection title="Snacks">
        {snacks.length ? (
          <div className="flex flex-col gap-2">
            {snacks.map((snack) => (
              <PastEntry
                key={snack.id}
                label={SNACK_LABEL}
                time={snack.t}
                note={snack.note}
                tone={C.brass}
              />
            ))}
          </div>
        ) : (
          <EmptyPastEntry label="No snacks logged" />
        )}
      </PastDaySection>

      <PastDaySection title="Workout">
        {workouts.length ? (
          <div className="flex flex-col gap-2">
            {workouts.map((workout) => (
              <PastEntry
                key={workout.id}
                label={WORKOUT_LABEL}
                time={workout.t}
                note={workout.note}
                tone={C.done}
                checked
              />
            ))}
          </div>
        ) : (
          <EmptyPastEntry label="No workout snack logged" />
        )}
      </PastDaySection>

      <PastDaySection title="Drinks">
        <div
          className="flex items-center justify-between rounded-xl px-4 py-3"
          style={{ background: C.surface }}
        >
          <span style={{ color: drinks ? C.chalk : C.muted }}>
            {drinks} {drinks === 1 ? "drink" : "drinks"}
          </span>
          {drinks > 0 && (
            <span className="flex items-center gap-[3px]" aria-hidden="true">
              {drinkCircles(drinks)
                .slice(0, DRINK_DOTS_MAX)
                .map((fill, i) => (
                  <DrinkDot key={i} size={10} fill={fill} />
                ))}
            </span>
          )}
        </div>
      </PastDaySection>

      <div className="mt-auto pt-4">{status}</div>
    </Screen>
  );
}

// The same day, opened for correction: the rail the today view uses, pointed at
// a date that has already been and gone. Nothing here writes through — the
// draft it edits lives upstairs and only reaches storage on Save — so the
// screen has to say, loudly and continuously, which day it is holding.
export function PastDayEditor({
  dateKey,
  grade,
  dirty,
  railProps,
  onCancel,
  onSave,
  status,
  overlay,
}) {
  return (
    <Screen overlay={overlay}>
      <header
        className="rounded-xl px-4 py-3"
        style={{
          background: C.surfaceBrass,
          borderLeft: `3px solid ${C.brass}`,
        }}
      >
        <p
          className="text-xs uppercase tracking-widest"
          style={{ color: C.brass, fontFamily: FONT.mono }}
        >
          Editing{dirty ? " · Unsaved changes" : ""}
        </p>
        <h1
          className="mt-1 text-2xl leading-tight"
          style={{ fontFamily: FONT.display }}
        >
          {formatDate(dateKey)}
        </h1>
      </header>

      {/* Under the band rather than beside it: the date is long enough that a
          pair of buttons on the same line would crowd it off its own screen. */}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{ background: "transparent", color: C.muted }}
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          data-haptic="commit"
          className="rounded-lg px-4 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{ background: C.done, color: C.ground }}
        >
          Save
        </button>
      </div>

      {/* Recomputed from the draft, so the day's verdict moves as it is
          corrected and you can see what a change costs before committing it. */}
      <GradeCard grade={grade} />

      <DayRail {...railProps} />

      <div className="mt-auto pt-4">{status}</div>
    </Screen>
  );
}

// The day's verdict, stated in words rather than left to an 11px glyph. Shared
// by the read-only past day and the editor so a correction's effect is shown in
// exactly the terms the day was judged in.
function GradeCard({ grade }) {
  return (
    <section
      className="mt-6 flex items-center justify-between gap-4 rounded-xl px-4 py-3"
      style={{ background: C.surface }}
      aria-label={`Grade: ${grade ? BADGE_LABEL[grade] : "No grade"}`}
    >
      <div>
        <p
          className="text-xs uppercase tracking-widest"
          style={{ color: C.muted, fontFamily: FONT.mono }}
        >
          Grade
        </p>
        <p
          className="mt-1 text-lg"
          style={{ fontFamily: FONT.display }}
          aria-live="polite"
        >
          {grade ? BADGE_LABEL[grade] : "No grade"}
        </p>
      </div>
      {grade && <DayBadge tier={grade} size={22} />}
    </section>
  );
}

function PastDaySection({ title, children }) {
  return (
    <section className="mt-6">
      <h2
        className="mb-3 text-xs uppercase tracking-widest"
        style={{ color: C.muted, fontFamily: FONT.mono }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

// Centred on the card the same way a rail row is centred on itself, and for the
// same reason: the tick answers for the whole entry, not for its first line.
// This card once mixed the two — an `items-start` row with a top-aligned tick
// and a `self-center` time — which read as the time sagging away from the label
// beside it the moment a note appeared.
function PastEntry({ label, time, note, tone, checked = false }) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-3"
      style={{ background: C.surface }}
    >
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        style={{
          background: checked ? tone : "transparent",
          border: `1px solid ${tone}`,
        }}
        aria-hidden="true"
      >
        {checked && <IconTick color={C.ground} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block" style={{ color: time ? C.chalk : C.muted }}>
          {label}
        </span>
        {note && (
          <span
            className="mt-1 block text-sm whitespace-pre-wrap"
            style={{ color: C.muted }}
          >
            {note}
          </span>
        )}
      </span>
      <span
        className="shrink-0 text-xs"
        style={{ color: time ? tone : C.rail, fontFamily: FONT.mono }}
      >
        {time ? clock(time) : "—"}
      </span>
    </div>
  );
}

function EmptyPastEntry({ label }) {
  return (
    <p
      className="rounded-xl px-4 py-3 text-sm"
      style={{ background: C.surface, color: C.muted }}
    >
      {label}
    </p>
  );
}

// A heading that shrinks rather than wraps. The dates these carry swing from
// "Sat, Aug 1" to "Wednesday, September 25, 2026", the room they get is whatever
// a pair of icon buttons leaves over, and a wrapped date pushes the whole screen
// down by a line on a narrow phone.
//
// `options` is the same date worded longest-first. A wording is shrunk as far as
// `min` before the next one down is tried, because a briefer date reads worse
// than a smaller one — the fallback is a last resort, not the first move.
//
// The measurement leans on two things staying still: the h1 is a block, so
// `clientWidth` is the width available whatever the type is doing, and
// `whitespace-nowrap` makes `scrollWidth` the width the line wants. Neither
// moves when the font size does, which is what keeps the observer below off its
// own tail. Sizing is one pass rather than a search — text width is near enough
// linear in font size that scaling by how far it ran over lands it, and a few
// single-pixel steps take up the rounding.
export function FitHeading({ options, max, min, className = "", style }) {
  const ref = useRef(null);
  const [shown, setShown] = useState({ text: options[0], size: max });
  // `options` is a fresh array most renders; its contents are what the fit
  // actually depends on, and a newline is the one thing a formatted date can't
  // contain — so the effect takes the list back apart rather than closing over
  // an identity that churns.
  const wordings = options.join("\n");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const texts = wordings.split("\n");
    let fitted = -1;

    const fit = () => {
      const avail = el.clientWidth;
      if (!avail) return;
      fitted = avail;

      let text = texts[0];
      let size = max;
      for (const candidate of texts) {
        text = candidate;
        size = max;
        el.textContent = candidate;
        el.style.fontSize = `${max}px`;
        if (el.scrollWidth > avail) {
          size = Math.max(min, Math.floor((max * avail) / el.scrollWidth));
          el.style.fontSize = `${size}px`;
          while (size > min && el.scrollWidth > avail) {
            size -= 1;
            el.style.fontSize = `${size}px`;
          }
        }
        if (el.scrollWidth <= avail) break;
      }

      // Left on the winner by hand: React has nothing to reconcile when the
      // winner is what it rendered last, and the node is still holding whatever
      // the loop measured.
      el.textContent = text;
      el.style.fontSize = `${size}px`;
      setShown({ text, size });
    };

    fit();

    // Width is the only thing worth refitting on. The box gets shorter every
    // time the type does, and refitting on that would be refitting on itself.
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== fitted) fit();
    });
    ro.observe(el.parentElement || el);
    return () => ro.disconnect();
  }, [wordings, max, min]);

  return (
    <h1
      ref={ref}
      className={`whitespace-nowrap ${className}`}
      style={{ ...style, fontSize: shown.size }}
    >
      {shown.text}
    </h1>
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

function IconPencil({ color }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.5 19.5l1-4 10-10a2.1 2.1 0 0 1 3 3l-10 10-4 1z"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 7.5l3 3"
        stroke={color}
        strokeWidth="1.7"
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
