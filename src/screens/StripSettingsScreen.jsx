import { SAMPLE_FORTNIGHT } from "../grade.js";
import { C, FONT } from "../theme.js";
import {
  ChoiceRow,
  STRIP_COLUMN_CLASS,
  STRIP_GRADE_OPTIONS,
  STRIP_MARK_OPTIONS,
  StripDay,
} from "../components/HistoryStrip.jsx";
import { Screen, StatusLine } from "../components/Screen.jsx";

export function StripSettingsScreen({
  stripMark,
  stripGrade,
  saving,
  saveError,
  notice,
  onBack,
  onPatchSettings,
}) {
  const patchSettings = onPatchSettings;

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
          Two-week strip
        </h1>
      </header>

      <section className="mt-8">
        <p
          className="text-xs uppercase tracking-widest"
          style={{ color: C.muted, fontFamily: FONT.mono }}
        >
          Marks
        </p>
        <div
          role="radiogroup"
          aria-label="How each day is drawn"
          className="mt-2"
        >
          {STRIP_MARK_OPTIONS.map((o) => (
            <ChoiceRow
              key={o.id}
              label={o.label}
              hint={o.hint}
              selected={stripMark === o.id}
              onSelect={() => patchSettings({ stripMark: o.id })}
            />
          ))}
        </div>
      </section>

      <section
        className="mt-6 pt-6"
        style={{ borderTop: `1px solid ${C.rail}` }}
      >
        <p
          className="text-xs uppercase tracking-widest"
          style={{ color: C.muted, fontFamily: FONT.mono }}
        >
          Grade
        </p>
        <div
          role="radiogroup"
          aria-label="How a finished day is graded"
          className="mt-2"
        >
          {STRIP_GRADE_OPTIONS.map((o) => (
            <ChoiceRow
              key={o.id}
              label={o.label}
              hint={o.hint}
              selected={stripGrade === o.id}
              onSelect={() => patchSettings({ stripGrade: o.id })}
            />
          ))}
        </div>
      </section>

      {/* The preview sits at the foot of the screen, where the real strip
            sits on the day view — so what you are judging is in the place you
            will be looking at it. It is docked there rather than merely placed
            there: seven options with a line of explanation each are taller than
            a phone, and a preview you have to scroll away from the controls to
            see is a preview you can't use. `mt-auto` handles the short-content
            case, `sticky` the tall one, and the inset keeps it off the home
            indicator — Screen's own bottom padding is outside the scrollport
            this sticks to.

            The row is hidden from screen readers: every mark in it is already
            described by the option that drew it, and fourteen sample days
            announcing their grades would bury the controls. */}
      <section
        className="sticky bottom-0 mt-auto pt-5"
        style={{
          background: C.ground,
          borderTop: `1px solid ${C.rail}`,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <p
          className="text-xs uppercase tracking-widest"
          style={{ color: C.muted, fontFamily: FONT.mono }}
        >
          Preview
        </p>
        <div className="mt-3 flex items-end justify-between" aria-hidden="true">
          {SAMPLE_FORTNIGHT.map((d) => (
            <div key={d.key} className={STRIP_COLUMN_CLASS}>
              <StripDay d={d} mark={stripMark} grade={stripGrade} />
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs" style={{ color: C.muted }}>
          Sample days, not yours — a real fortnight wouldn't show every grade.
        </p>
        <StatusLine saveError={saveError} notice={notice} saving={saving} />
      </section>
    </Screen>
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
