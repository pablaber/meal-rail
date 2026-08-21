import { drinkCircles } from "../grade.js";
import { formatDate } from "../day.js";
import { C, FONT } from "../theme.js";
import { StatusLine } from "./Screen.jsx";

export const STRIP_COLUMN_CLASS =
  "flex flex-1 flex-col items-center gap-1 px-[2px] py-1";
export const DRINK_DOTS_MAX = 4;
const STRIP_DRINK_DOTS = 3;
const STRIP_LINE_EXTRAS = 2;
const STRIP_LINE_DRINKS = 2;
const STRIP_CAPSULE_H = 24;
const STRIP_CAPSULE_FULL_H = 28;
const STRIP_BAND_H = 3;
const STRIP_BANDS_MAX = 4;
const STRIP_SEG_H = 4;
const STRIP_SEG_GAP = 1.5;
const STRIP_SEG_W = 9;

export const STRIP_MARK_OPTIONS = [
  {
    id: "boxes",
    label: "Boxes",
    hint: "One box per meal, snacks and drinks below. The original.",
  },
  {
    id: "capsule",
    label: "Capsule",
    hint: "The boxes become one bar that fills up. Shorter, and it stops growing when you add a meal slot.",
  },
  {
    id: "capsuleFull",
    label: "One capsule",
    hint: "Everything in a single mark — meals rise, snacks and drinks fall from the top.",
  },
  {
    id: "track",
    label: "Tracked bar",
    hint: "A segment per meal inside the day's full height, so an empty day reads as an empty box.",
  },
];

export const STRIP_GRADE_OPTIONS = [
  {
    id: "badge",
    label: "Badge",
    hint: "A shape under each column — a disc, a ring, a broken ring.",
  },
  {
    id: "tint",
    label: "Tinted date",
    hint: "The day's number takes its grade's colour. Saves the most room.",
  },
  {
    id: "none",
    label: "None",
    hint: "Just the marks. What you did, with nothing scoring it.",
  },
];

const STRIP_TINT = {
  gold: { color: C.gold, glow: true },
  green: { color: C.done },
  silver: { color: C.silver },
  bad: { color: C.red },
  terrible: { color: C.red, rule: true },
  empty: { color: C.faintText },
};

const BADGE_SIZE = 11;
export const BADGE_LABEL = {
  gold: "Perfect day",
  green: "Good day",
  silver: "Decent day",
  bad: "Bad day",
  terrible: "Terrible day",
  empty: "No meals logged",
};

export function HistoryStrip({
  recentDays,
  weekendSpans,
  mark,
  grade,
  weekExtras,
  weekDrinks,
  onOpenDay,
  saveError,
  notice,
  saving,
}) {
  return (
    <section className="mt-auto pt-8">
      <p
        className="text-xs uppercase tracking-widest"
        style={{ color: C.muted, fontFamily: FONT.mono }}
      >
        Last two weeks
      </p>
      <div className="relative mt-4 flex items-end justify-between">
        {weekendSpans.map((span) => (
          <div
            key={`weekend-${span.start}`}
            aria-hidden="true"
            className="absolute -top-1.5 -bottom-1 rounded-xl"
            style={{
              left: `${(span.start / recentDays.length) * 100}%`,
              width: `${((span.end - span.start + 1) / recentDays.length) * 100}%`,
              background: C.weekendWash,
              boxShadow: `inset 0 0 0 1px ${C.weekendEdge}`,
            }}
          >
            {span.end > span.start && (
              <div
                className="absolute inset-y-1 w-px"
                style={{
                  left: `${(100 / (span.end - span.start + 1)) * 1}%`,
                  background: C.weekendSeam,
                }}
              />
            )}
          </div>
        ))}
        {recentDays.map((day) =>
          day.isToday ? (
            <div key={day.key} className={`${STRIP_COLUMN_CLASS} relative`}>
              <StripDay d={day} mark={mark} grade={grade} />
            </div>
          ) : (
            <button
              key={day.key}
              onClick={() => onOpenDay(day.key)}
              aria-label={`Open ${formatDate(day.key)}${day.badge ? `, ${BADGE_LABEL[day.badge]}` : ", no grade"}`}
              className={`${STRIP_COLUMN_CLASS} relative rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white`}
            >
              <StripDay d={day} mark={mark} grade={grade} />
            </button>
          ),
        )}
      </div>
      <p className="mt-4 text-sm" style={{ color: C.muted }}>
        {weekExtras === 0
          ? "Nothing unplanned logged this week."
          : `${weekExtras} unplanned ${weekExtras === 1 ? "snack" : "snacks"} in the last 7 days.`}{" "}
        {weekDrinks === 0
          ? "No drinks logged this week."
          : `${weekDrinks} ${weekDrinks === 1 ? "drink" : "drinks"} in the last 7 days.`}
      </p>
      <StatusLine saveError={saveError} notice={notice} saving={saving} />
    </section>
  );
}

const STRIP_MARKS = {
  boxes: StripBoxes,
  capsule: StripCapsule,
  capsuleFull: StripCapsuleFull,
  track: StripTrack,
};

export function StripDay({ d, mark = "boxes", grade = "badge" }) {
  const Mark = STRIP_MARKS[mark] || STRIP_MARKS["boxes"];
  return (
    <>
      <Mark d={d} />
      {/* The verdict on a finished day. A fixed height, so the days without one
          keep their numbers on the same baseline. */}
      {grade === "badge" && (
        <div className="flex h-[13px] items-center justify-center">
          {d.badge && <DayBadge tier={d.badge} />}
        </div>
      )}
      <StripDate d={d} tinted={grade === "tint"} />
    </>
  );
}

// The original: one box per planned slot, filled bottom-up, with snacks and
// drinks in two bands under them. The bands are separate and vertical, which is
// what lets them hold three marks each where the flatter marks below hold two.
function StripBoxes({ d }) {
  return (
    <>
      <div className="flex flex-col-reverse gap-[3px]">
        {Array.from({ length: Math.max(d.planned, 1) }).map((_, i) => (
          <span
            key={i}
            className="block h-[7px] w-[7px] rounded-[2px]"
            style={{ background: i < d.checks ? C.done : C.faint }}
          />
        ))}
      </div>
      <div className="mt-1 flex h-3 flex-col items-center gap-[2px]">
        {Array.from({ length: Math.min(d.extra, 3) }).map((_, i) => (
          <span
            key={i}
            className="block h-[3px] w-[7px] rounded-full"
            style={{ background: C.brass }}
          />
        ))}
      </div>
      {/* A fixed-height band, laid out across rather than up, so the day
          numbers stay on one line and drinks never read as meals. Three 6px
          dots is exactly what a column has room for. */}
      <div className="flex h-[6px] items-center justify-center gap-[1px]">
        {drinkCircles(d.drinks)
          .slice(0, STRIP_DRINK_DOTS)
          .map((fill, i) => (
            <DrinkDot key={i} size={6} fill={fill} />
          ))}
      </div>
    </>
  );
}

// The boxes drawn as one bar with the seams left in. Its height is fixed, so
// unlike the boxes it doesn't grow when a slot is added to the plan or when a
// workout snack lifts one day above its neighbours.
function StripCapsule({ d }) {
  return (
    <>
      <StripFill d={d} height={STRIP_CAPSULE_H} />
      <StripNegatives d={d} />
    </>
  );
}

// Everything in a single mark. Meals rise from the bottom and negatives come
// down from the top, so the gap left in the middle is how the day went: a clean
// full day closes it from below, a bad one closes it from above. They can meet,
// and a capsule with nothing left in it is the right picture for that day.
function StripCapsuleFull({ d }) {
  const bands = [
    ...Array.from({ length: Math.min(d.extra, STRIP_BANDS_MAX) }, () => 1),
    // A half circle becomes a half-width band rather than a paler red: the
    // same "half a drink" the circles say, in the one language this mark has.
    ...drinkCircles(d.drinks).slice(0, STRIP_BANDS_MAX),
  ].slice(0, STRIP_BANDS_MAX);
  const extras = Math.min(d.extra, STRIP_BANDS_MAX);

  return (
    <StripFill d={d} height={STRIP_CAPSULE_FULL_H} width={8}>
      {bands.map((fill, i) => (
        <span
          key={i}
          className="absolute block rounded-[1px]"
          style={{
            top: i * (STRIP_BAND_H + 1),
            height: STRIP_BAND_H,
            // Centred, so a half-width drink band still reads as part of the
            // column rather than as something stuck to one edge.
            left: `${((1 - fill) / 2) * 100}%`,
            right: `${((1 - fill) / 2) * 100}%`,
            background: i < extras ? C.brass : C.red,
          }}
        />
      ))}
    </StripFill>
  );
}

// The capsule both capsule marks are made of: a track the height of the day,
// filled from the bottom by what was checked, with a hairline where each box
// seam used to be. Anything else the mark wants to draw inside it comes in as
// children and lands on top of the fill.
function StripFill({ d, height, width = 7, children }) {
  const planned = Math.max(d.planned, 1);
  // A day whose plan shrank after it was logged can hold more checks than it
  // planned. The fill is clamped rather than allowed past the top, where it
  // would say "more than full" in a mark that has no way to mean that.
  const filled = Math.min(d.checks, planned) / planned;

  return (
    <span
      className="relative block overflow-hidden rounded-full"
      style={{ width, height, background: C.faint }}
    >
      <span
        className="absolute inset-x-0 bottom-0 block"
        style={{ height: `${filled * 100}%`, background: C.done }}
      />
      {Array.from({ length: planned - 1 }).map((_, i) => (
        <span
          key={i}
          className="absolute inset-x-0 block h-px"
          style={{
            bottom: `${((i + 1) / planned) * 100}%`,
            background: C.ground,
          }}
        />
      ))}
      {children}
    </span>
  );
}

// A segment per checked meal, stacked inside a track the height of the whole
// plan. What the capsule says as a proportion this says as a count you can read
// off — and an untouched day is an empty box rather than a mark you have to
// look twice at. Negatives sit above the rim: they were never part of the day's
// capacity, so they don't belong inside the thing that measures it.
function StripTrack({ d }) {
  const planned = Math.max(d.planned, 1);
  const checks = Math.min(d.checks, planned);
  const height = planned * STRIP_SEG_H + (planned - 1) * STRIP_SEG_GAP + 4;

  const seg = (background, key, width = STRIP_SEG_W) => (
    <span
      key={key}
      className="block shrink-0 rounded-[1.5px]"
      style={{ width, height: STRIP_SEG_H, background }}
    />
  );

  return (
    <div className="flex flex-col items-center gap-[2px]">
      <div
        className="flex flex-col-reverse items-center"
        style={{ gap: STRIP_SEG_GAP, minHeight: STRIP_SEG_H }}
      >
        {Array.from({ length: Math.min(d.extra, STRIP_LINE_EXTRAS) }).map(
          (_, i) => seg(C.brass, `x${i}`, STRIP_SEG_W - 2),
        )}
        {drinkCircles(d.drinks)
          .slice(0, STRIP_LINE_DRINKS)
          .map((fill, i) => seg(C.red, `d${i}`, (STRIP_SEG_W - 2) * fill))}
      </div>
      <div
        className="flex flex-col-reverse items-center justify-start rounded-[3px] p-[2px]"
        style={{
          height,
          width: STRIP_SEG_W + 4,
          gap: STRIP_SEG_GAP,
          background: C.surface,
          boxShadow: `inset 0 0 0 1px ${C.rail}`,
        }}
      >
        {Array.from({ length: checks }).map((_, i) => seg(C.done, i))}
      </div>
    </div>
  );
}

// Snacks and drinks on one line instead of two stacked bands. Flatter than the
// bands by about ten pixels, and it holds fewer marks for it — see
// `STRIP_LINE_EXTRAS`.
function StripNegatives({ d }) {
  return (
    <div className="flex h-[7px] items-center justify-center gap-[2px]">
      {Array.from({ length: Math.min(d.extra, STRIP_LINE_EXTRAS) }).map(
        (_, i) => (
          <span
            key={i}
            className="block h-[5px] w-[2px] rounded-full"
            style={{ background: C.brass }}
          />
        ),
      )}
      {drinkCircles(d.drinks)
        .slice(0, STRIP_LINE_DRINKS)
        .map((fill, i) => (
          <DrinkDot key={i} size={5} fill={fill} />
        ))}
    </div>
  );
}

// The day of the month, and — when the strip is set to tint it — the day's
// grade. Today is chalk whatever the setting: it has no grade to wear, and it
// is the one column the eye should find first.
function StripDate({ d, tinted }) {
  const tint = tinted && d.badge ? STRIP_TINT[d.badge] : null;

  return (
    <span
      className="text-[10px]"
      style={{
        color: d.isToday ? C.chalk : tint?.color || C.faintText,
        fontFamily: FONT.mono,
        textShadow: tint?.glow ? `0 0 6px ${C.goldGlow}` : undefined,
        // `terrible` and `bad` are the same red, because the two colours that
        // would have separated them are both too faint to put a numeral in.
        // A rule under the worst day does the job colour can't.
        borderBottom: tint?.rule ? `1px solid ${tint.color}` : undefined,
      }}
    >
      {d.key.slice(8)}
    </span>
  );
}

// One row of a radio group: the label, why you'd pick it, and a dot. A button
// with `role="radio"` rather than an <input>, to match the switches on the
// settings screen — they are the same kind of control and should feel it.
export function ChoiceRow({ label, hint, selected, onSelect }) {
  return (
    <button
      onClick={onSelect}
      role="radio"
      aria-checked={selected}
      className="mt-1 flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      style={{ background: selected ? C.surface : "transparent" }}
    >
      <span
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
        style={{ border: `1px solid ${selected ? C.done : C.faint}` }}
      >
        {selected && (
          <span
            className="block h-2 w-2 rounded-full"
            style={{ background: C.done }}
          />
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        <span className="mt-0.5 block text-xs" style={{ color: C.muted }}>
          {hint}
        </span>
      </span>
    </button>
  );
}

// One mark for the whole day. Shape carries the grade as much as colour does —
// a lit disc, then a plain one, then an empty ring, then a ring in pieces —
// because at eleven pixels colour alone can't hold five tiers apart. It is the
// only glyph in a strip column that isn't decorative, so it gets a name.
export function DayBadge({ tier, size = BADGE_SIZE }) {
  const label = BADGE_LABEL[tier];

  if (tier === "terrible") {
    // Three arcs and three gaps: the ring, come apart.
    const w = size / 4;
    const r = (size - w) / 2;
    const seg = (2 * Math.PI * r) / 3;
    return (
      <svg
        width={size}
        height={size}
        className="block"
        role="img"
        aria-label={label}
      >
        <title>{label}</title>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={C.redDeepEdge}
          strokeWidth={w}
          strokeDasharray={`${(seg * 2) / 3} ${seg / 3}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
    );
  }

  const styles = {
    gold: {
      background: C.gold,
      boxShadow: `0 0 ${size / 2}px ${C.goldGlow}, inset 0 1px 0 ${C.sheen}`,
    },
    green: { background: C.done },
    silver: { background: C.silver },
    bad: { border: `${size / 6}px solid ${C.red}` },
    // No opacity on this one: 70% of `faint` over the ground lands back at
    // 2.4:1, which is where it came from. The ring is the whole mark here.
    empty: { border: `1px solid ${C.faint}` },
  };

  return (
    <span
      className="block"
      role="img"
      aria-label={label}
      title={label}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        ...styles[tier],
      }}
    />
  );
}

// The calendar's version of the same verdict: the day's number inside its own
// grade. A day with nothing to say is bare, and today gets a ring instead of a

export function DrinkDot({ size, fill }) {
  return (
    <span
      className="relative block shrink-0 overflow-hidden rounded-full"
      style={{ width: size, height: size, background: C.rail }}
      aria-hidden="true"
    >
      <span
        className="absolute bottom-0 left-0 right-0 block"
        style={{ height: `${fill * 100}%`, background: C.red }}
      />
    </span>
  );
}

// The shell both editors share — scrim, safe-area padding, Escape and a
