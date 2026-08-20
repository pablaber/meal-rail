import {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { C, FONT } from "./theme.js";
import {
  load,
  save,
  clear,
  exportFile,
  exportRawFile,
  importFile,
  exportClipboard,
  exportRawClipboard,
  importText,
} from "./storage.js";
import { BUILD_ID, checkForUpdate } from "./update.js";
import {
  SAMPLE_FORTNIGHT,
  dayBadge,
  daySummary,
  drinkCircles,
  isEmptyDay,
  plannedBase,
  summarize,
} from "./grade.js";
import {
  RETENTION_DAYS,
  dateAt,
  dayHeadings,
  dayKey,
  formatDate,
  formatDateShort,
  shiftDay,
  stampOn,
  trimDays,
} from "./day.js";

const DEFAULTS = {
  slots: [
    { id: "s1", label: "Breakfast" },
    { id: "s2", label: "Lunch" },
    { id: "s4", label: "Dinner" },
  ],
  trainingEnabled: true,
  promptNotes: false,
  // How the two-week strip draws a day. Two flat keys rather than one nested
  // object: `load` and `restoreBackup` merge settings shallowly, so a backup
  // written before a third option existed would replace the whole object and
  // silently drop it. Separate keys each fall back on their own.
  //
  // The defaults are what the strip has always drawn, so an existing install
  // and a fresh one look identical until someone chooses otherwise.
  stripMark: "boxes",
  stripGrade: "badge",
};

// The screens reached through history. Seeding the first view, the popstate
// listener and the Escape key all read this list, so a new screen is added in
// one place instead of three that can drift apart.
const HISTORY_VIEWS = ["settings", "calendar", "day", "strip"];

// A workout snack isn't a slot you can re-cut — it's one fixed kind of entry,
// like an unplanned one, so its label is a constant rather than a setting.
const WORKOUT_LABEL = "Workout Snack";
const SNACK_LABEL = "Snack";

// Backfilling a past day has no clock to read: the entry happened whenever it
// happened, and the app wasn't there. So an entry added to a past day lands at
// the hour its slot usually falls on and the editor opens on top of it, which
// makes the time something you confirm rather than something invented behind
// your back. Today stamps the live clock; its editor opens only when the user
// has asked for note prompts in settings.
const BACKFILL_TIMES = ["08:00", "13:00", "19:00"];
const BACKFILL_FALLBACK = "12:00";
const BACKFILL_SNACK = "15:00";
const BACKFILL_WORKOUT = "17:00";

// How long a notice sits in the status line before clearing itself. A notice
// reports something the app just did, so nothing but the clock can retire one —
// every call site sets it and moves on, and half of them are on a screen you
// leave immediately afterwards. Long enough to read a short line, short enough
// that it isn't still standing over "Saving…" by the next tap.
const NOTICE_MS = 4000;

// A notice carries its own tone, because the line reports both "Backup
// restored" and "That file isn't a Meal Rail backup" and those cannot look the
// same. `failed` borrows the colour a save failure already uses.
const NO_NOTICE = { text: "", failed: false };

// The add buttons carry a 1px dashed edge; the bubbles beside them are filled
// and have none. They match heights only if the fill keeps the border box the
// edge would have occupied.
//
// The bubbles carry text-base for the same reason the add buttons do: a row of
// pills only lines up while every one of them sets the same type size, and a
// bubble left to inherit would follow whatever wrapped it later.
const BUBBLE_EDGE = "1px solid transparent";

// Every row on the rail — meal, snack, workout — is built to one shape, and
// everything in it centres on the row rather than hanging off the label's first
// line. A note makes a row half again as tall, and the node is the mark for the
// whole entry, note included, not for its opening line.
//
// It is also what keeps the rail readable. Top-aligning leaves a noted row's
// node sitting closer to the node above it than to the one below — 72px then
// 56px, on a rail whose other gaps are all 56. Centring splits the extra height
// evenly and gets that back to 64.
const ROW_CLASS =
  "row flex w-full items-center gap-4 rounded-xl px-2 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white";
const ROW_NODE_CLASS =
  "node relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full";
const ROW_TIME_CLASS = "text-xs";

// One column of the two-week strip. Fourteen of these share the width of a
// phone, so the spacing between them lives *inside* the column as padding
// rather than as a `gap` on the row: the columns still look 4px apart, but the
// touch zones tile edge to edge instead of leaving a third of the strip dead.
// `py-1` is free height on the same argument — the row has vertical slack above
// it, and a taller target is a target a thumb can miss vertically and still hit.
const STRIP_COLUMN_CLASS =
  "flex flex-1 flex-col items-center gap-1 px-[2px] py-1";

// How many circles each surface has room for. Past the cap the count beside
// them is the honest number; the circles are only ever the shape of the day.
const DRINK_DOTS_MAX = 4;
const STRIP_DRINK_DOTS = 3;

// The marks that lay their negatives out *across* the column instead of up it
// hold fewer of them: a column is about 21px wide, and two brass ticks plus two
// drink circles with their gaps already spend 20 of it. Past the cap the day is
// still graded on the true count — these marks were never the number, only the
// shape of it. `boxes` keeps its two stacked bands and their taller caps.
const STRIP_LINE_EXTRAS = 2;
const STRIP_LINE_DRINKS = 2;

// One capsule holding the whole day: meals rise from the bottom, negatives come
// down from the top, and the gap left between them is how the day went.
const STRIP_CAPSULE_H = 24;
const STRIP_CAPSULE_FULL_H = 28;
const STRIP_BAND_H = 3;
const STRIP_BANDS_MAX = 4;

// One segment per checked meal, stacked inside a track the height of the plan.
const STRIP_SEG_H = 4;
const STRIP_SEG_GAP = 1.5;
const STRIP_SEG_W = 9;

// What the settings screen calls each choice, and the one-line reason to pick
// it. The strip screen reads these and so does the row on the settings screen
// that says what is currently set, so the two can't drift.
const STRIP_MARK_OPTIONS = [
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

const STRIP_GRADE_OPTIONS = [
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

// The tinted date, tier by tier. Text has to clear 4.5:1 on `ground`, which is
// a higher bar than the badge's marks answer to, and it rules out the two
// colours you would reach for first: `redDeepEdge` and `faint` are both 3.5:1
// — theme.js reserves them for marks that stand alone with nothing written on
// them, and a numeral is not that.
//
// So `terrible` takes a rule under the number instead of a second red. `bad`
// and `terrible` are the same 5.0:1 red, told apart by shape, the way every
// other grade on this strip is. `empty` lands on the date's own colour, which
// is right twice over: it clears the floor at 5.3:1, and a day with nothing
// checked should look unmarked. What separates it from a day with nothing
// logged at all is the marks above, which is where that difference lives.
const STRIP_TINT = {
  gold: { color: C.gold, glow: true },
  green: { color: C.done },
  silver: { color: C.silver },
  bad: { color: C.red },
  terrible: { color: C.red, rule: true },
  empty: { color: C.faintText },
};

// The four backup buttons tile a 2×2 grid. A grid only reads as one while every
// cell is the same shape, so they take their width from the column rather than
// from the length of their own label.
const DATA_BUTTON_CLASS =
  "w-full rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white";
const DATA_BUTTON_STYLE = { background: C.surfaceHi, color: C.chalk };

const BADGE_SIZE = 11;

const BADGE_LABEL = {
  gold: "Perfect day",
  green: "Good day",
  silver: "Decent day",
  bad: "Bad day",
  terrible: "Terrible day",
  empty: "No meals logged",
};

const CALENDAR_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CALENDAR_DAY_SIZE = 34;

// On the calendar the grade and the date are the same mark: the number sits in
// the disc. The strip's shape language doesn't survive being blown up to hold a
// numeral — a broken ring or a hollow one just reads as a badly drawn circle at
// this size — so every tier here is a plain fill and colour alone carries it.
// The ink flips with the fill so the number stays legible on either.
//
// Except at the bottom, where colour alone couldn't carry it: `terrible` and
// `empty` are the two most opposite verdicts here and their fills measure
// 1.0:1 against *each other*, both sitting at ~1.9:1 against the page and both
// wearing chalk numerals. They were the same disc in two hues. `terrible` takes
// a ring for the difference rather than a lighter fill, because a fill light
// enough to be seen on its own is too light to read a number off — see
// `redDeepEdge` in theme.js.
const CALENDAR_TIER = {
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

const clock = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

// An <input type="time"> speaks "HH:MM" in local time; the record speaks ISO.
const toTimeField = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Rebuild the timestamp on the day being edited rather than on today, so
// editing yesterday from a day-old tab can't move the entry to now. Seconds
// carry over: they're what keeps same-minute entries in a stable order.
const fromTimeField = (key, value, iso) => {
  const [y, m, d] = key.split("-").map(Number);
  const [hh, mm] = value.split(":").map(Number);
  const prev = new Date(iso);
  return new Date(
    y,
    m - 1,
    d,
    hh,
    mm,
    prev.getSeconds(),
    prev.getMilliseconds(),
  ).toISOString();
};

const BLANK_DAY = { checks: {}, notes: {}, unplanned: [], workouts: [] };

const uid = () => Math.random().toString(36).slice(2, 9);

export default function MealRail() {
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // Set through `showNotice` only — see the timer below.
  const [notice, setNotice] = useState(NO_NOTICE);
  const [settings, setSettings] = useState(DEFAULTS);
  const [days, setDays] = useState({});
  const [recovery, setRecovery] = useState(null);
  const [recoveryConfirm, setRecoveryConfirm] = useState(null);
  const [recoveryPasteOpen, setRecoveryPasteOpen] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [today, setToday] = useState(dayKey());
  // Settings and the calendar are screens, not panels, and both are reached
  // through history so the device's own back button leaves them the same way
  // the in-app arrow does. Seeded from history state, so a reload on either
  // comes back to the same screen.
  const [view, setView] = useState(() => {
    const v = window.history.state?.view;
    return HISTORY_VIEWS.includes(v) ? v : "today";
  });
  const [selectedDay, setSelectedDay] = useState(
    () => window.history.state?.day || null,
  );
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  // A past day is edited against a draft rather than written through on every
  // tap the way today is. Today is the day you are living: a tap is the record.
  // A past day is a reconstruction, and a reconstruction wants a Save.
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // The popstate listener is mounted once and never re-subscribes, so it can't
  // close over `draft`. This mirrors it synchronously, which also means the
  // guard is already down by the time Save's own `history.back()` lands.
  const editRef = useRef({ active: false, dirty: false, key: null });
  // The month the calendar is showing, as a plain year/month pair rather than
  // a Date — every opening resets this to the current month, and browsing
  // months moves it without touching history.
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  // The newest month the calendar will show. Derived from `today` rather than a
  // fresh `new Date()` so the ceiling and the grid's "today" cell always agree,
  // including across a midnight rollover with the calendar already open.
  const currentMonth = useMemo(() => {
    const d = dateAt(today);
    return { year: d.getFullYear(), month: d.getMonth() };
  }, [today]);

  // Load
  useEffect(() => {
    let alive = true;
    (async () => {
      const parsed = await load();
      if (alive && parsed.status === "valid") {
        setSettings({ ...DEFAULTS, ...(parsed.state.settings || {}) });
        setDays(parsed.state.days || {});
      } else if (alive && parsed.status === "unreadable") {
        setRecovery(parsed);
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // The only way a notice is set. Each one replaces whatever was on the line
  // and takes its predecessor's timer with it, so the update check's
  // "Checking…" → "You're on the latest version" reads as one line changing
  // rather than two racing clocks.
  const noticeTimer = useRef(0);
  const showNotice = useCallback((text, { failed = false } = {}) => {
    clearTimeout(noticeTimer.current);
    setNotice({ text, failed });
    noticeTimer.current = setTimeout(() => setNotice(NO_NOTICE), NOTICE_MS);
  }, []);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  const openSettings = () => {
    window.history.pushState({ view: "settings" }, "");
    setView("settings");
  };

  // Its own history entry on top of settings, so back lands where you came
  // from rather than at the day view.
  const openStripSettings = () => {
    window.history.pushState({ view: "strip" }, "");
    setView("strip");
  };

  const openCalendar = () => {
    setCalendarMonth(currentMonth);
    window.history.pushState({ view: "calendar" }, "");
    setView("calendar");
  };

  const openPastDay = (key) => {
    if (key >= today) return;
    setSelectedDay(key);
    window.history.pushState({ view: "day", day: key }, "");
    setView("day");
  };

  // The in-app back button walks history rather than setting state directly, so
  // it leaves exactly what the device's back button leaves — nothing stale
  // behind it. Settings and the calendar both close the same way.
  const goBack = () => window.history.back();

  // Editing a past day is its own history entry, so the device's back button
  // leaves it the way the in-app Cancel does. With unsaved work on screen that
  // has to be refused: the pop is undone by pushing the entry straight back,
  // and the question is asked instead. Save and Discard both take the guard
  // down before calling `back()`, so their own pop passes straight through.
  useEffect(() => {
    const onPop = (e) => {
      if (editRef.current.active && !e.state?.edit) {
        if (editRef.current.dirty) {
          window.history.pushState(
            { view: "day", day: editRef.current.key, edit: true },
            "",
          );
          setConfirmDiscard(true);
          return;
        }
        editRef.current = { active: false, dirty: false, key: null };
        setDraft(null);
        setDirty(false);
      }
      const v = e.state?.view;
      setSelectedDay(v === "day" ? e.state?.day || null : null);
      setView(HISTORY_VIEWS.includes(v) ? v : "today");
      setConfirmClearOpen(false);
      setEditing(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Escape leaves any screen reached through history, the way it leaves a
  // dialog. A past day returns to the calendar that opened it, and a past day
  // being edited asks first if there is anything to lose.
  //
  // A dialog on top owns Escape outright: it listens too, and without this the
  // one press would close the dialog and walk out of the screen behind it.
  useEffect(() => {
    if (!HISTORY_VIEWS.includes(view)) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (editing || confirmDiscard || confirmClearOpen || pasteOpen) return;
      if (draft) cancelEdit();
      else goBack();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view, editing, confirmDiscard, confirmClearOpen, pasteOpen, draft]);

  // Roll over at midnight / on refocus
  useEffect(() => {
    const tick = () => setToday(dayKey());
    const i = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(i);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  const persist = useCallback(async (nextSettings, nextDays) => {
    setSaving(true);
    const trimmed = trimDays(nextDays);
    const ok = await save({ settings: nextSettings, days: trimmed });
    setSaveError(!ok);
    setSaving(false);
  }, []);

  const slots = settings.slots;

  // `settings` can arrive from a hand-edited backup, so neither of these is
  // trusted to name a real option — an unknown value falls back to the default
  // rather than rendering nothing at all.
  const stripMark = STRIP_MARK_OPTIONS.some((o) => o.id === settings.stripMark)
    ? settings.stripMark
    : DEFAULTS.stripMark;
  const stripGrade = STRIP_GRADE_OPTIONS.some(
    (o) => o.id === settings.stripGrade,
  )
    ? settings.stripGrade
    : DEFAULTS.stripGrade;
  const stripMarkLabel = STRIP_MARK_OPTIONS.find(
    (o) => o.id === stripMark,
  ).label;
  const stripGradeLabel = STRIP_GRADE_OPTIONS.find(
    (o) => o.id === stripGrade,
  ).label;

  // The day every entry control below writes to. Today unless a past day is
  // open in the editor, in which case it is that day's draft — which is what
  // lets one set of handlers, one rail, and one pair of dialogs serve both.
  const editingPast = !!draft;
  const activeKey = draft ? draft.key : today;
  const activeRecord = draft ? draft.record : days[today] || BLANK_DAY;

  // A workout snack arrives already checked, so it raises `planned` and the
  // day's check count by one together: it can never cost the day a grade, and it
  // can never cover for a meal that went unchecked.
  const writeDay = (patch) => {
    const next = { ...activeRecord, ...patch };
    // `in` rather than a fallback: removing the last workout patches the key to
    // undefined so it drops out of the JSON, and `??` would read that as "not
    // being changed" and leave the day planning a slot that no longer exists.
    const workouts =
      ("workouts" in patch ? patch.workouts : activeRecord.workouts) || [];
    next.planned =
      (editingPast ? plannedBase(activeRecord, slots) : slots.length) +
      workouts.length;

    if (editingPast) {
      editRef.current.dirty = true;
      setDirty(true);
      setDraft({ key: activeKey, record: next });
      return;
    }
    const nextDays = { ...days, [today]: next };
    setDays(nextDays);
    persist(settings, nextDays);
  };

  // `settings` inside a click handler is the value from the render that made
  // the handler. Two controls tapped before React re-renders would both spread
  // that same object, and the first change would be quietly overwritten by the
  // second — which is easy to do on the strip screen, where two groups of
  // options sit one above the other. Patches read the live value from here
  // instead of closing over it.
  const settingsRef = useRef(settings);
  // Kept current from two directions, and it needs both: this one catches
  // settings arriving from a load or a restore, and the write inside the patch
  // below is what makes two patches in the same tick compose — a re-render is
  // too late for the second one to see the first.
  settingsRef.current = settings;

  const patchSettings = (patch) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    persist(next, days);
  };

  // Both ways in end here. A restore replaces everything — in state and on disk
  // — whichever way the JSON arrived, so a file and a paste can't drift into
  // meaning two different things.
  const restoreBackup = (parsed) => {
    const nextSettings = { ...DEFAULTS, ...(parsed.settings || {}) };
    setSettings(nextSettings);
    setDays(parsed.days || {});
    persist(nextSettings, parsed.days || {});
    showNotice("Backup restored");
  };

  // Recovery is the one place a restore cannot be optimistic. The damaged raw
  // value remains the only durable copy until save succeeds, so the normal app
  // stays blocked if the browser refuses either replacement or reset.
  const resolveRecovery = async () => {
    setRecoveryError("");

    if (recoveryConfirm.kind === "reset") {
      const ok = await clear();
      if (!ok) {
        setRecoveryError("Couldn't reset — this browser is blocking storage.");
        setRecoveryConfirm(null);
        return;
      }
      setSettings(DEFAULTS);
      setDays({});
    } else {
      const parsed = recoveryConfirm.parsed;
      const nextSettings = { ...DEFAULTS, ...(parsed.settings || {}) };
      const nextDays = parsed.days || {};
      const ok = await save({ settings: nextSettings, days: nextDays });
      if (!ok) {
        setRecoveryError(
          "Couldn't replace the damaged data — this browser is blocking storage.",
        );
        setRecoveryConfirm(null);
        return;
      }
      setSettings(nextSettings);
      setDays(nextDays);
    }

    setRecoveryConfirm(null);
    setRecovery(null);
  };

  // A backfilled entry has no clock to read, so it lands at its slot's usual
  // hour and hands the editor straight over. Today's entries can opt into that
  // same handoff, with focus on their note. Cancelling an editor leaves the
  // entry logged — Uncheck and Remove sit in the dialog and take it back.
  const backfilling = (kind, id, label, patch, promptToday = false) => {
    writeDay(patch);
    if (editingPast || promptToday) {
      setEditing({ kind, id, label, focusNote: promptToday && !editingPast });
    }
  };

  const check = (slot, index) =>
    backfilling(
      "slot",
      slot.id,
      slot.label,
      {
        checks: {
          ...activeRecord.checks,
          [slot.id]: editingPast
            ? stampOn(activeKey, BACKFILL_TIMES[index] || BACKFILL_FALLBACK)
            : new Date().toISOString(),
        },
      },
      settings.promptNotes,
    );

  const uncheck = (id) => {
    const checks = { ...activeRecord.checks };
    const notes = { ...(activeRecord.notes || {}) };
    delete checks[id];
    delete notes[id];
    writeDay({ checks, notes });
  };

  const editCheck = (id, { time, note }) => {
    const notes = { ...(activeRecord.notes || {}) };
    if (note) notes[id] = note;
    else delete notes[id];
    writeDay({
      checks: {
        ...activeRecord.checks,
        [id]: fromTimeField(activeKey, time, activeRecord.checks[id]),
      },
      notes,
    });
  };

  const addUnplanned = () => {
    const id = uid();
    backfilling(
      "unplanned",
      id,
      SNACK_LABEL,
      {
        unplanned: [
          ...(activeRecord.unplanned || []),
          {
            id,
            t: editingPast
              ? stampOn(activeKey, BACKFILL_SNACK)
              : new Date().toISOString(),
          },
        ],
      },
      settings.promptNotes,
    );
  };

  const removeUnplanned = (id) =>
    writeDay({
      unplanned: (activeRecord.unplanned || []).filter((u) => u.id !== id),
    });

  const editUnplanned = (id, { time, note }) =>
    writeDay({
      unplanned: (activeRecord.unplanned || []).map((u) =>
        u.id === id
          ? {
              ...u,
              t: fromTimeField(activeKey, time, u.t),
              note: note || undefined,
            }
          : u,
      ),
    });

  // Already checked the moment it is logged — a workout snack is recorded after
  // the fact, not planned ahead of it, so there is nothing left to tick off.
  // One a day: the list stays a list because that is what the rail and the
  // migration already read, but only ever holds the one.
  const addWorkout = () => {
    if ((activeRecord.workouts || []).length) return;
    const id = uid();
    backfilling(
      "workout",
      id,
      WORKOUT_LABEL,
      {
        workouts: [
          {
            id,
            t: editingPast
              ? stampOn(activeKey, BACKFILL_WORKOUT)
              : new Date().toISOString(),
          },
        ],
      },
      settings.promptNotes,
    );
  };

  const removeWorkout = (id) => {
    const left = (activeRecord.workouts || []).filter((w) => w.id !== id);
    writeDay({ workouts: left.length ? left : undefined });
  };

  const editWorkout = (id, { time, note }) =>
    writeDay({
      workouts: (activeRecord.workouts || []).map((w) =>
        w.id === id
          ? {
              ...w,
              t: fromTimeField(activeKey, time, w.t),
              note: note || undefined,
            }
          : w,
      ),
    });

  const addDrink = () => writeDay({ drinks: (activeRecord.drinks || 0) + 1 });

  // undefined rather than 0 so the key drops out of the JSON entirely and days
  // without drinks stay as small as they were before this existed.
  const setDrinkCount = (n) => writeDay({ drinks: n > 0 ? n : undefined });

  // Opening the editor is its own history entry, so the device's back button
  // and the in-app Cancel leave it by the same door.
  const startEdit = (key) => {
    editRef.current = { active: true, dirty: false, key };
    setDraft({ key, record: days[key] || BLANK_DAY });
    setDirty(false);
    window.history.pushState({ view: "day", day: key, edit: true }, "");
  };

  // Drops the guard before walking back, so the pop this causes is let through
  // rather than turned into another question.
  const leaveEdit = () => {
    editRef.current = { active: false, dirty: false, key: null };
    setDraft(null);
    setDirty(false);
    setEditing(null);
    setConfirmDiscard(false);
    window.history.back();
  };

  const cancelEdit = () => {
    if (editRef.current.dirty) setConfirmDiscard(true);
    else leaveEdit();
  };

  const saveEdit = () => {
    const nextDays = { ...days };
    // A day left with nothing on it loses its key rather than keeping a hollow
    // record: opening a blank day and saving it unchanged has to be a no-op.
    if (isEmptyDay(draft.record)) delete nextDays[draft.key];
    else nextDays[draft.key] = draft.record;
    setDays(nextDays);
    persist(settings, nextDays);
    showNotice(`Saved ${formatDateShort(draft.key)}`);
    leaveEdit();
  };

  const history = useMemo(() => {
    const out = [];
    for (let i = 13; i >= 0; i--) {
      const k = shiftDay(today, -i);
      const dow = dateAt(k).getDay();
      out.push({
        ...daySummary(days, k, settings.slots.length, k === today),
        isWeekend: dow === 0 || dow === 6,
      });
    }
    return out;
  }, [days, today, settings.slots.length]);

  // Contiguous runs of weekend days in the strip, as column indices. Usually
  // one or two full Saturday+Sunday pairs, but a run can be a single day when
  // the fourteen-day window starts or ends mid-weekend. The backdrop drawn
  // behind the strip is one shape per run rather than one per day, so the
  // weekend reads as a unit.
  const weekendSpans = useMemo(() => {
    const spans = [];
    history.forEach((d, idx) => {
      if (!d.isWeekend) return;
      const last = spans[spans.length - 1];
      if (last && last.end === idx - 1) last.end = idx;
      else spans.push({ start: idx, end: idx });
    });
    return spans;
  }, [history]);

  const atCurrentMonth =
    calendarMonth.year === currentMonth.year &&
    calendarMonth.month === currentMonth.month;

  // Backwards is unbounded; forwards stops at the current month. There is
  // nothing to read in a month that hasn't happened, and a chevron that walks
  // into empty grids is a way to get lost rather than a way to browse.
  const shiftMonth = (delta) =>
    setCalendarMonth(({ year, month }) => {
      const d = new Date(year, month + delta, 1);
      const ceiling = new Date(currentMonth.year, currentMonth.month, 1);
      const next = d > ceiling ? ceiling : d;
      return { year: next.getFullYear(), month: next.getMonth() };
    });

  // One cell per date in the month, in Sunday-first weekday order, with a
  // blank cell for each weekday before the 1st. No trailing blanks: the grid
  // is seven columns wide, so whatever's left over after the last date just
  // leaves the final row short, which reads the same as an explicit blank.
  const calendarCells = useMemo(() => {
    const { year, month } = calendarMonth;
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const key = dayKey(new Date(year, month, day));
      cells.push({
        day,
        ...daySummary(days, key, settings.slots.length, key === today),
      });
    }
    return cells;
  }, [calendarMonth, days, settings.slots.length, today]);

  const calendarMonthLabel = useMemo(
    () =>
      new Date(calendarMonth.year, calendarMonth.month, 1).toLocaleDateString(
        undefined,
        {
          month: "long",
          year: "numeric",
        },
      ),
    [calendarMonth],
  );

  const selectedDayRecord = selectedDay ? days[selectedDay] : null;
  const selectedDaySummary = selectedDay
    ? daySummary(days, selectedDay, settings.slots.length, false)
    : null;

  // The draft's grade, recomputed as it is edited, so a correction shows what
  // it does to the day before it is committed.
  const draftGrade = draft
    ? dayBadge(summarize(draft.record, slots.length))
    : null;

  const weekExtras = history.slice(7).reduce((a, d) => a + d.extra, 0);
  const weekDrinks = history.slice(7).reduce((a, d) => a + d.drinks, 0);

  // Today against itself as the reference year, so the heading never carries a
  // year — the one day you can't be wrong about which one it is.
  const dateHeadings = useMemo(() => dayHeadings(today, today), [today]);

  // Resolved from the record rather than captured when the row was tapped, so
  // a midnight rollover under an open dialog closes it instead of writing to a
  // day that is no longer on screen.
  const editTarget = useMemo(() => {
    if (!editing) return null;
    if (editing.kind === "drinks") {
      const n = activeRecord.drinks || 0;
      return n > 0 ? { count: n } : null;
    }
    if (editing.kind === "slot") {
      const t = (activeRecord.checks || {})[editing.id];
      return t
        ? { time: toTimeField(t), note: (activeRecord.notes || {})[editing.id] }
        : null;
    }
    const list =
      (editing.kind === "workout"
        ? activeRecord.workouts
        : activeRecord.unplanned) || [];
    const e = list.find((x) => x.id === editing.id);
    return e ? { time: toTimeField(e.t), note: e.note } : null;
  }, [editing, activeRecord]);

  // One rail, one set of handlers, whichever day is open.
  const railProps = {
    record: activeRecord,
    slots,
    trainingEnabled: settings.trainingEnabled,
    onCheck: check,
    onAddSnack: addUnplanned,
    onAddWorkout: addWorkout,
    onAddDrink: addDrink,
    onEdit: setEditing,
  };

  // The entry editors, shared by today and the past-day editor. On a past day
  // they carry the date in their eyebrow, so which day is being written to
  // stays legible under a modal that covers the header saying so.
  const entryDialogs = (
    <>
      {editing && editTarget && editing.kind === "drinks" && (
        <DrinkDialog
          count={editTarget.count}
          eyebrow={
            editingPast ? `Editing · ${formatDateShort(activeKey)}` : undefined
          }
          onClose={() => setEditing(null)}
          onSave={(n) => {
            setDrinkCount(n);
            setEditing(null);
          }}
          onClear={() => {
            setDrinkCount(0);
            setEditing(null);
          }}
        />
      )}

      {editing && editTarget && editing.kind !== "drinks" && (
        <EditDialog
          key={editing.id}
          title={editing.label}
          eyebrow={
            editingPast ? `Editing · ${formatDateShort(activeKey)}` : undefined
          }
          time={editTarget.time}
          note={editTarget.note}
          focusNote={editing.focusNote}
          removeLabel={editing.kind === "slot" ? "Uncheck" : "Remove"}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            if (editing.kind === "slot") editCheck(editing.id, patch);
            else if (editing.kind === "workout") editWorkout(editing.id, patch);
            else editUnplanned(editing.id, patch);
            setEditing(null);
          }}
          onRemove={() => {
            if (editing.kind === "slot") uncheck(editing.id);
            else if (editing.kind === "workout") removeWorkout(editing.id);
            else removeUnplanned(editing.id);
            setEditing(null);
          }}
        />
      )}
    </>
  );

  if (!ready) {
    return (
      <div
        className="flex items-center justify-center min-h-96 p-8"
        style={{ background: C.ground, color: C.muted, fontFamily: FONT.body }}
      >
        Opening today…
      </div>
    );
  }

  if (recovery) {
    const hasRaw = recovery.raw !== null;
    return (
      <Screen
        overlay={
          <>
            {recoveryConfirm && (
              <ConfirmDialog
                title={
                  recoveryConfirm.kind === "reset"
                    ? "Reset Meal Rail"
                    : "Replace damaged data"
                }
                message={
                  recoveryConfirm.kind === "reset"
                    ? "This permanently deletes the damaged saved value. Export or copy it first if you may need it later."
                    : "This permanently replaces the damaged saved value with the selected backup. Export or copy it first if you may need it later."
                }
                confirmLabel={
                  recoveryConfirm.kind === "reset"
                    ? "Reset everything"
                    : "Replace data"
                }
                onClose={() => setRecoveryConfirm(null)}
                onConfirm={resolveRecovery}
              />
            )}
            {recoveryPasteOpen && (
              <PasteDialog
                onClose={() => setRecoveryPasteOpen(false)}
                onLoad={(text) => {
                  const parsed = importText(text);
                  setRecoveryPasteOpen(false);
                  setRecoveryConfirm({ kind: "replace", parsed });
                }}
              />
            )}
          </>
        }
      >
        <div className="flex flex-1 flex-col justify-center py-8">
          <p
            className="text-xs uppercase tracking-widest"
            style={{ color: C.brass, fontFamily: FONT.mono }}
          >
            Recovery needed
          </p>
          <h1
            className="mt-2 text-3xl leading-tight"
            style={{ fontFamily: FONT.display }}
          >
            Your saved data can't be opened
          </h1>
          <p className="mt-4 text-sm" style={{ color: C.muted }}>
            Meal Rail has paused before opening an empty day so it can't
            overwrite the data already on this device.
          </p>

          {hasRaw ? (
            <>
              <p className="mt-6 text-sm" style={{ color: C.muted }}>
                Take a copy of the damaged value before resetting it or
                replacing it with a backup.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    exportRawFile(recovery.raw);
                    setRecoveryError("");
                  }}
                  className={DATA_BUTTON_CLASS}
                  style={DATA_BUTTON_STYLE}
                >
                  Download raw data
                </button>
                <button
                  onClick={async () => {
                    const ok = await exportRawClipboard(recovery.raw);
                    setRecoveryError(
                      ok ? "Raw data copied." : "Couldn't reach the clipboard.",
                    );
                  }}
                  className={DATA_BUTTON_CLASS}
                  style={DATA_BUTTON_STYLE}
                >
                  Copy raw text
                </button>
              </div>
            </>
          ) : (
            <p className="mt-6 text-sm" style={{ color: C.brass }} role="alert">
              This browser wouldn't allow Meal Rail to read its storage, so the
              raw value can't be exported right now.
            </p>
          )}

          <div className="mt-8 border-t pt-6" style={{ borderColor: C.rail }}>
            <p
              className="text-xs uppercase tracking-widest"
              style={{ color: C.muted, fontFamily: FONT.mono }}
            >
              Recover
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  try {
                    const parsed = await importFile();
                    setRecoveryConfirm({ kind: "replace", parsed });
                  } catch (e) {
                    setRecoveryError(e.message);
                  }
                }}
                className={DATA_BUTTON_CLASS}
                style={DATA_BUTTON_STYLE}
              >
                Load a backup
              </button>
              <button
                onClick={() => setRecoveryPasteOpen(true)}
                className={DATA_BUTTON_CLASS}
                style={DATA_BUTTON_STYLE}
              >
                Paste a backup
              </button>
            </div>
            <button
              onClick={() => setRecoveryConfirm({ kind: "reset" })}
              className="mt-6 w-full rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ background: "transparent", color: C.red }}
            >
              Reset and start over
            </button>
            <p
              className="mt-4 min-h-4 text-xs"
              style={{
                color: recoveryError.startsWith("Raw data copied")
                  ? C.faintText
                  : C.brass,
                fontFamily: FONT.mono,
              }}
              aria-live="polite"
              role={
                recoveryError && !recoveryError.startsWith("Raw data copied")
                  ? "alert"
                  : undefined
              }
            >
              {recoveryError}
            </p>
          </div>
        </div>
      </Screen>
    );
  }

  if (view === "settings") {
    return (
      <Screen
        overlay={
          <>
            {confirmClearOpen && (
              <ConfirmDialog
                title="Erase all history"
                message="This permanently deletes every logged day. It can't be undone."
                confirmLabel="Erase everything"
                onClose={() => setConfirmClearOpen(false)}
                onConfirm={async () => {
                  const ok = await clear();
                  if (!ok) {
                    setConfirmClearOpen(false);
                    showNotice(
                      "Couldn't erase history — this browser is blocking storage.",
                      { failed: true },
                    );
                    return;
                  }
                  setDays({});
                  setConfirmClearOpen(false);
                  showNotice("History erased");
                }}
              />
            )}
            {pasteOpen && (
              <PasteDialog
                onClose={() => setPasteOpen(false)}
                onLoad={(text) => {
                  // Throws on anything that isn't a backup, which the dialog
                  // catches and reports without losing what was pasted.
                  const parsed = importText(text);
                  setPasteOpen(false);
                  restoreBackup(parsed);
                }}
              />
            )}
          </>
        }
      >
        <header className="flex items-start gap-3">
          <button
            onClick={goBack}
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
            Settings
          </h1>
        </header>

        <section className="mt-8">
          <p
            className="text-xs uppercase tracking-widest"
            style={{ color: C.muted, fontFamily: FONT.mono }}
          >
            Your day
          </p>

          <label className="mt-3 flex items-center justify-between gap-3 text-sm">
            <span>Offer a workout snack</span>
            <button
              onClick={() =>
                patchSettings({ trainingEnabled: !settings.trainingEnabled })
              }
              role="switch"
              aria-checked={settings.trainingEnabled}
              className="h-6 w-11 shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{
                background: settings.trainingEnabled ? C.done : C.surfaceHi,
              }}
            >
              <span
                className="node block h-5 w-5 rounded-full"
                style={{
                  background: C.ground,
                  transform: `translateX(${settings.trainingEnabled ? 22 : 2}px)`,
                }}
              />
            </button>
          </label>

          <label className="mt-4 flex items-center justify-between gap-3 text-sm">
            <span>Open notes after logging</span>
            <button
              onClick={() =>
                patchSettings({ promptNotes: !settings.promptNotes })
              }
              role="switch"
              aria-checked={settings.promptNotes}
              className="h-6 w-11 shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{
                background: settings.promptNotes ? C.done : C.surfaceHi,
              }}
            >
              <span
                className="node block h-5 w-5 rounded-full"
                style={{
                  background: C.ground,
                  transform: `translateX(${settings.promptNotes ? 22 : 2}px)`,
                }}
              />
            </button>
          </label>

          {/* A screen rather than another switch: it has two questions in it
              and a preview to answer them against, and neither fits on a row.
              What is set shows here so the trip is only worth making to
              change something. */}
          <button
            onClick={openStripSettings}
            className="mt-4 flex w-full items-center justify-between gap-3 rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <span className="min-w-0">
              <span className="block text-sm">Two-week strip</span>
              <span className="mt-0.5 block text-xs" style={{ color: C.muted }}>
                {stripMarkLabel} · {stripGradeLabel}
              </span>
            </span>
            <IconChevronRight color={C.muted} />
          </button>
        </section>

        {/* Four ways to move the data, in a grid that says which is which: a
            column per direction, a row per medium, so every button in it has an
            opposite number sitting directly beside it. */}
        <section
          className="mt-8 pt-6"
          style={{ borderTop: `1px solid ${C.rail}` }}
        >
          <p
            className="text-xs uppercase tracking-widest"
            style={{ color: C.muted, fontFamily: FONT.mono }}
          >
            Your data
          </p>
          <p className="mt-2 text-sm" style={{ color: C.muted }}>
            Every day you've logged lives on this device alone. A file is what
            you keep; text is for moving a backup somewhere a file can't go.
          </p>

          <div className="mt-4 grid grid-cols-2 items-center gap-2">
            <p
              className="text-xs"
              style={{ color: C.muted, fontFamily: FONT.mono }}
            >
              Back up
            </p>
            <p
              className="text-xs"
              style={{ color: C.muted, fontFamily: FONT.mono }}
            >
              Restore
            </p>

            <button
              onClick={() => {
                exportFile({ settings, days });
                showNotice("Backup downloaded");
              }}
              aria-label="Download a backup file"
              className={DATA_BUTTON_CLASS}
              style={DATA_BUTTON_STYLE}
            >
              Download a file
            </button>
            <button
              onClick={async () => {
                try {
                  restoreBackup(await importFile());
                } catch (e) {
                  // The messages come from `storage.js` and are already written
                  // for this line — "That isn't a Meal Rail backup".
                  showNotice(e.message, { failed: true });
                }
              }}
              aria-label="Restore a backup from a file"
              className={DATA_BUTTON_CLASS}
              style={DATA_BUTTON_STYLE}
            >
              Load a file
            </button>

            <button
              onClick={async () => {
                const ok = await exportClipboard({ settings, days });
                if (ok) showNotice("Backup copied");
                else
                  showNotice("Couldn't reach the clipboard", { failed: true });
              }}
              aria-label="Copy the backup as text"
              className={DATA_BUTTON_CLASS}
              style={DATA_BUTTON_STYLE}
            >
              Copy as text
            </button>
            <button
              onClick={() => setPasteOpen(true)}
              aria-label="Restore a backup from pasted text"
              className={DATA_BUTTON_CLASS}
              style={DATA_BUTTON_STYLE}
            >
              Paste text
            </button>
          </div>
        </section>

        {/* What the app says about itself, at the foot of the screen: which
            build this is, and the status line the day view carries too. The
            destructive action lives down here too, on its own, so it is never
            a stray tap away from the backup buttons above. */}
        <div className="mt-auto pt-8">
          {/* An installed copy checks for itself whenever it comes back to
              the foreground; this is for when you want to know right now. */}
          <div
            className="flex items-center justify-between gap-3 pt-4"
            style={{ borderTop: `1px solid ${C.rail}` }}
          >
            <span
              className="text-xs"
              style={{ color: C.faintText, fontFamily: FONT.mono }}
            >
              Version {BUILD_ID}
            </span>
            <button
              onClick={async () => {
                showNotice("Checking…");
                const result = await checkForUpdate({ force: true });
                if (result === "updating") showNotice("Updating…");
                else if (result === "unknown")
                  showNotice("Couldn't check — you may be offline", {
                    failed: true,
                  });
                else showNotice("You're on the latest version");
              }}
              className="rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ background: C.surfaceHi, color: C.chalk }}
            >
              Check for updates
            </button>
          </div>
          <StatusLine saveError={saveError} notice={notice} saving={saving} />
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => setConfirmClearOpen(true)}
              className="rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ background: "transparent", color: C.red }}
            >
              Erase all history
            </button>
          </div>
        </div>
      </Screen>
    );
  }

  if (view === "strip") {
    return (
      <Screen>
        <header className="flex items-start gap-3">
          <button
            onClick={goBack}
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
          <div
            className="mt-3 flex items-end justify-between"
            aria-hidden="true"
          >
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

  if (view === "calendar") {
    return (
      <Screen>
        <header className="flex items-start gap-3">
          <button
            onClick={goBack}
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
          {/* The way home from six months back. It lives in the header, and only
              while it has somewhere to go, so appearing and disappearing costs
              the grid below no movement — the heading sets this row's height. */}
          {!atCurrentMonth && (
            <button
              onClick={() => setCalendarMonth(currentMonth)}
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
            <button
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ background: C.surface }}
            >
              <IconChevronLeft color={C.chalk} />
            </button>
            <p className="text-lg" style={{ fontFamily: FONT.display }}>
              {calendarMonthLabel}
            </p>
            {/* Kept on screen rather than removed at the edge: the row is the
                month's frame, and dropping one end of it would re-centre the
                label every time you reached the present. */}
            <button
              onClick={() => shiftMonth(1)}
              disabled={atCurrentMonth}
              aria-label="Next month"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ background: atCurrentMonth ? "transparent" : C.surface }}
            >
              <IconChevronRight color={atCurrentMonth ? C.faint : C.chalk} />
            </button>
          </div>

          <div className="mt-6 grid grid-cols-7 gap-y-2">
            {CALENDAR_WEEKDAYS.map((w) => (
              <span
                key={w}
                className="mb-1 text-center text-[10px] uppercase tracking-widest"
                style={{ color: C.muted, fontFamily: FONT.mono }}
              >
                {w}
              </span>
            ))}
            {calendarCells.map((cell, i) =>
              cell ? (
                <div key={cell.key} className="flex justify-center">
                  {cell.key < today ? (
                    <button
                      onClick={() => openPastDay(cell.key)}
                      aria-label={`Open ${formatDate(cell.key)}${
                        cell.badge
                          ? `, ${BADGE_LABEL[cell.badge]}`
                          : ", no grade"
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
                <div key={`blank-${i}`} aria-hidden="true" />
              ),
            )}
          </div>
        </section>
      </Screen>
    );
  }

  if (view === "day" && selectedDay && selectedDay < today) {
    if (draft) {
      return (
        <PastDayEditor
          dateKey={draft.key}
          grade={draftGrade}
          dirty={dirty}
          railProps={railProps}
          onCancel={cancelEdit}
          onSave={saveEdit}
          status={
            <StatusLine saveError={saveError} notice={notice} saving={saving} />
          }
          overlay={
            <>
              {entryDialogs}
              {confirmDiscard && (
                <ConfirmDialog
                  title="Discard changes"
                  eyebrow="Unsaved changes"
                  message={`Your edits to ${formatDate(draft.key)} haven't been saved yet. Leaving now loses them.`}
                  confirmLabel="Discard"
                  // Not the arming pause "erase everything" gets: this loses one
                  // day's edits, and the work it guards is still on screen behind it.
                  armMs={0}
                  onClose={() => setConfirmDiscard(false)}
                  onConfirm={leaveEdit}
                />
              )}
            </>
          }
        />
      );
    }
    return (
      <PastDay
        dateKey={selectedDay}
        today={today}
        record={selectedDayRecord}
        slots={slots}
        summary={selectedDaySummary}
        editable={selectedDay >= shiftDay(today, -RETENTION_DAYS)}
        onEdit={() => startEdit(selectedDay)}
        onBack={goBack}
        status={
          <StatusLine saveError={saveError} notice={notice} saving={saving} />
        }
      />
    );
  }

  return (
    <Screen overlay={entryDialogs}>
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        {/* `min-w-0` or the heading doesn't shrink: nowrap makes its min-content
            width the whole string, and the flex item would shove the buttons
            beside it off the screen rather than give any of that width back. */}
        <div className="min-w-0 flex-1">
          <p
            className="text-xs uppercase tracking-widest"
            style={{ color: C.muted, fontFamily: FONT.mono }}
          >
            Today
          </p>
          <FitHeading
            options={dateHeadings}
            max={30}
            min={20}
            className="mt-1 leading-tight"
            style={{ fontFamily: FONT.display }}
          />
        </div>
        <div className="mt-1 flex shrink-0 items-center gap-2">
          <button
            onClick={openCalendar}
            aria-label="Calendar"
            className="flex h-9 w-9 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{ background: C.surface }}
          >
            <IconCalendar color={C.muted} />
          </button>
          <button
            onClick={openSettings}
            aria-label="Settings"
            className="flex h-9 w-9 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{ background: C.surface }}
          >
            <IconSliders color={C.muted} />
          </button>
        </div>
      </header>

      <DayRail {...railProps} />

      {/* History. mt-auto takes up whatever the rail leaves over, so a short
          day puts the slack above this strip instead of below it. */}
      <section className="mt-auto pt-8">
        <p
          className="text-xs uppercase tracking-widest"
          style={{ color: C.muted, fontFamily: FONT.mono }}
        >
          Last two weeks
        </p>
        {/* Every column but today's opens its day, the way a calendar cell
            does. Today's is a plain element rather than a dead button, because
            `openPastDay` refuses it — the strip's last column is the day the
            rail above is already showing. */}
        <div className="relative mt-4 flex items-end justify-between">
          {/* One wash per weekend run, not one per day — Saturday and Sunday
              read as a single "the weekend" zone. The seam between them stays
              so the pair doesn't lose the fact that it's two days. */}
          {weekendSpans.map((span) => (
            <div
              key={`weekend-${span.start}`}
              aria-hidden="true"
              className="absolute -top-1.5 -bottom-1 rounded-xl"
              style={{
                left: `${(span.start / history.length) * 100}%`,
                width: `${((span.end - span.start + 1) / history.length) * 100}%`,
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
          {history.map((d) =>
            d.isToday ? (
              <div key={d.key} className={`${STRIP_COLUMN_CLASS} relative`}>
                <StripDay d={d} mark={stripMark} grade={stripGrade} />
              </div>
            ) : (
              // The label carries the grade whatever the marks are set to, so
              // turning the badge off changes how the strip looks and not what
              // it says.
              <button
                key={d.key}
                onClick={() => openPastDay(d.key)}
                aria-label={`Open ${formatDate(d.key)}${
                  d.badge ? `, ${BADGE_LABEL[d.badge]}` : ", no grade"
                }`}
                className={`${STRIP_COLUMN_CLASS} relative rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white`}
              >
                <StripDay d={d} mark={stripMark} grade={stripGrade} />
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
    </Screen>
  );
}

// The rail and the two rows of controls under it: everything you do to a day,
// whichever day it is. Today writes through it on every tap; the past-day
// editor points it at a draft. Neither knows which, which is the point — the
// screen that wraps it decides where a patch lands.
function DayRail({
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

function PastDay({
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
function PastDayEditor({
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
function FitHeading({ options, max, min, className = "", style }) {
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

// The page itself: the full visible area, the type, and the column both screens
// are laid out in. `overlay` sits beside the column rather than inside it, which
// is where the dialogs have always hung.
function Screen({ children, overlay }) {
  return (
    <div
      className="flex w-full flex-col px-5 sm:px-8"
      style={{
        // 100dvh, plus the insets folded in, is exactly the visible area: the
        // installed app fills the screen and stops, with nothing to scroll.
        minHeight: "100dvh",
        paddingTop: "calc(env(safe-area-inset-top) + 1.5rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)",
        background: C.ground,
        color: C.chalk,
        fontFamily: FONT.body,
      }}
    >
      <style>{`
        .node, .seg, .row { transition: all 220ms cubic-bezier(.2,.7,.3,1); }
        @media (prefers-reduced-motion: reduce) {
          .node, .seg, .row { transition: none !important; }
        }
      `}</style>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        {children}
      </div>

      {overlay}
    </div>
  );
}

// What the app has to say about itself, at the foot of whichever screen you are
// on — settings reports its backups and updates through the same line the day
// view reports saving through.
//
// Nothing to say most of the time: a line standing by to say "saved" is worth
// less than the quiet. It keeps its height while it is empty so the foot of the
// screen doesn't jump when there is something to say, and it stays mounted
// either way — an aria-live region only announces text that arrives in a region
// that was already there.
//
// Two tones, not three: something went wrong, or the app is just talking. A
// notice that reports a failure takes the same brass a blocked save takes,
// because "That file isn't a Meal Rail backup" in the quiet grey reads as
// though the restore went fine.
function StatusLine({ saveError, notice, saving }) {
  return (
    <p
      className="mt-4 min-h-4 text-xs"
      style={{
        color: saveError || notice.failed ? C.brass : C.faintText,
        fontFamily: FONT.mono,
      }}
      aria-live="polite"
    >
      {saveError
        ? "Couldn't save — this browser is blocking storage."
        : notice.text
          ? notice.text
          : saving
            ? "Saving…"
            : ""}
    </p>
  );
}

// The way in to settings, and the way back out.
function IconSliders({ color }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 7h12.4M3 17h5.4M13.6 17H21"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle
        cx="18"
        cy="7"
        r="2.6"
        stroke={color}
        strokeWidth="1.7"
        fill="none"
      />
      <circle
        cx="11"
        cy="17"
        r="2.6"
        stroke={color}
        strokeWidth="1.7"
        fill="none"
      />
    </svg>
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

// The way in to the calendar, beside settings and matching its treatment.
function IconCalendar({ color }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3.5"
        y="5"
        width="17"
        height="15"
        rx="2"
        stroke={color}
        strokeWidth="1.7"
      />
      <path
        d="M3.5 9.5h17M8 3v3.5M16 3v3.5"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

// The way in to correcting a past day, drawn to the same weight as the calendar
// and settings icons the today header carries.
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

function IconChevronLeft({ color }) {
  return (
    <svg
      width="16"
      height="16"
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

function IconChevronRight({ color }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M9 5l7 7-7 7"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// The contents of one strip column, in whichever shape the strip is set to.
// Only the contents — the column that holds them is a button or a plain box
// depending on whether the day can be opened, and it owns the sizing either way.
//
// Every mark below draws the same four facts: how many meals were planned and
// how many were checked, unplanned snacks, drinks. They differ in how much
// height that costs and in what the shape says first. The grade and the date
// are common to all of them, which is why they live out here — the two settings
// are independent, and any mark can wear any grade.
const STRIP_MARKS = {
  boxes: StripBoxes,
  capsule: StripCapsule,
  capsuleFull: StripCapsuleFull,
  track: StripTrack,
};

function StripDay({
  d,
  mark = DEFAULTS.stripMark,
  grade = DEFAULTS.stripGrade,
}) {
  const Mark = STRIP_MARKS[mark] || STRIP_MARKS[DEFAULTS.stripMark];
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
function ChoiceRow({ label, hint, selected, onSelect }) {
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
function DayBadge({ tier, size = BADGE_SIZE }) {
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
// fill — it hasn't been graded yet, so it can't wear a colour.
function CalendarDay({ day, tier, isToday }) {
  const style = tier ? CALENDAR_TIER[tier] : null;
  const label = tier ? BADGE_LABEL[tier] : null;

  return (
    <span
      className="flex items-center justify-center rounded-full text-sm"
      role={label ? "img" : undefined}
      aria-label={label ? `${day}: ${label}` : undefined}
      title={label || undefined}
      style={{
        width: CALENDAR_DAY_SIZE,
        height: CALENDAR_DAY_SIZE,
        fontFamily: FONT.mono,
        background: style?.background || "transparent",
        color: style?.color || (isToday ? C.chalk : C.muted),
        boxShadow: style?.glow
          ? `0 0 ${CALENDAR_DAY_SIZE / 3}px ${C.goldGlow}, inset 0 1px 0 ${C.sheen}`
          : undefined,
        // A graded day and today are mutually exclusive — `daySummary` withholds
        // the badge from today — so these two rings never contend for the edge.
        border: style?.border || (isToday ? `1px solid ${C.muted}` : undefined),
      }}
    >
      {day}
    </span>
  );
}

// A circle that fills from the bottom. One component for the badge and the
// two-week strip both, so half a circle looks the same in either place.
function DrinkDot({ size, fill }) {
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
// backdrop tap to close. Sharing it is what keeps the two looking alike.
function Dialog({ title, eyebrow = "Editing", ariaLabel, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{
        background: C.scrim,
        paddingTop: "calc(env(safe-area-inset-top) + 1rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || `Edit ${title}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl p-5"
        style={{
          background: C.surface,
          color: C.chalk,
          fontFamily: FONT.body,
        }}
      >
        <p
          className="text-xs uppercase tracking-widest"
          style={{ color: C.muted, fontFamily: FONT.mono }}
        >
          {eyebrow}
        </p>
        <h2
          className="mt-1 text-2xl leading-tight"
          style={{ fontFamily: FONT.display }}
        >
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

// A pause long enough that "erase everything" can't be a reflexive
// double-tap — the confirm button stays disabled until it elapses.
const CONFIRM_ARM_MS = 5000;

// A yes/no dialog for actions that can't be undone, styled like the entry
// editors above. The confirm button only arms — turning red and becoming
// clickable — once `armMs` has passed. Erasing every day earned that pause;
// discarding one day's unsaved edits, with the work still on screen behind the
// dialog, passes 0 and arms immediately.
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
  eyebrow = "This can't be undone",
  armMs = CONFIRM_ARM_MS,
}) {
  const [armed, setArmed] = useState(armMs === 0);
  const [submitting, setSubmitting] = useState(false);
  // State does not update until the next render, so it cannot by itself stop
  // two clicks delivered in the same frame. The ref closes that gap while the
  // disabled state gives the user immediate feedback for the rest of the wait.
  const submittingRef = useRef(false);

  useEffect(() => {
    if (armMs === 0) return;
    const t = setTimeout(() => setArmed(true), armMs);
    return () => clearTimeout(t);
  }, [armMs]);

  const close = () => {
    if (!submittingRef.current) onClose();
  };

  const confirm = async () => {
    if (!armed || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog title={title} eyebrow={eyebrow} ariaLabel={title} onClose={close}>
      <p className="mt-3 text-sm" style={{ color: C.muted }}>
        {message}
      </p>
      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          onClick={close}
          disabled={submitting}
          className="rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
          style={{ background: "transparent", color: C.muted }}
        >
          Cancel
        </button>
        <button
          onClick={confirm}
          disabled={!armed || submitting}
          aria-busy={submitting}
          className="rounded-lg px-4 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
          style={{
            background: armed ? C.red : C.surfaceHi,
            color: armed ? C.ground : C.muted,
          }}
        >
          {submitting ? "Working…" : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

// The other half of "Copy as text". Reading the clipboard isn't something a page
// can count on being allowed to do, so the text arrives the way it left: pasted
// by hand, into a field.
//
// This is the one place a failure is reported inside a dialog rather than on the
// status line. Everything else that reports a failure has already finished
// doing whatever it was doing; here the pasted JSON is still on screen and
// usually one truncated line away from being valid, so closing the dialog to say
// so would throw away the thing being complained about.
function PasteDialog({ onLoad, onClose }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  return (
    <Dialog
      title="Paste a backup"
      eyebrow="Restoring"
      ariaLabel="Restore a backup from pasted text"
      onClose={onClose}
    >
      <p className="mt-3 text-sm" style={{ color: C.muted }}>
        This replaces every day currently logged on this device.
      </p>

      <label className="mt-4 block text-sm" style={{ color: C.muted }}>
        Backup text
        <textarea
          rows={6}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError("");
          }}
          placeholder='{ "settings": …, "days": … }'
          spellCheck="false"
          autoCapitalize="off"
          autoCorrect="off"
          className="mt-1 w-full resize-none rounded-lg px-3 py-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{
            background: C.surfaceHi,
            color: C.chalk,
            border: "none",
            fontFamily: FONT.mono,
          }}
        />
      </label>

      {/* Mounted only when there is something to say — the dialog is free to
          grow, unlike the status line, which holds its height instead. */}
      {error && (
        <p
          className="mt-2 text-xs"
          style={{ color: C.brass, fontFamily: FONT.mono }}
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{ background: "transparent", color: C.muted }}
        >
          Cancel
        </button>
        <button
          onClick={() => {
            try {
              onLoad(text);
            } catch (e) {
              setError(e.message);
            }
          }}
          disabled={!text.trim()}
          className="rounded-lg px-4 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
          style={{ background: C.done, color: C.ground }}
        >
          Restore
        </button>
      </div>
    </Dialog>
  );
}

// The pill downstairs only counts up. Coming back down happens here, where it
// takes a deliberate visit — and a draft, so Cancel is a real cancel.
function DrinkDialog({ count, eyebrow, onSave, onClear, onClose }) {
  const [draft, setDraft] = useState(count);

  const step =
    "flex h-11 w-11 items-center justify-center rounded-full text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40";
  const stepStyle = { background: C.surfaceHi, color: C.chalk };

  return (
    <Dialog title="Drinks" eyebrow={eyebrow} onClose={onClose}>
      <div className="mt-5 flex items-center justify-center gap-6">
        <button
          onClick={() => setDraft(Math.max(0, draft - 1))}
          disabled={draft === 0}
          aria-label="One fewer drink"
          className={step}
          style={stepStyle}
        >
          −
        </button>
        <span
          className="min-w-[2ch] text-center text-4xl"
          style={{ fontFamily: FONT.display }}
          aria-live="polite"
        >
          {draft}
        </span>
        <button
          onClick={() => setDraft(draft + 1)}
          aria-label="One more drink"
          className={step}
          style={stepStyle}
        >
          +
        </button>
      </div>

      <div className="mt-4 flex h-3 items-center justify-center gap-[3px]">
        {drinkCircles(draft)
          .slice(0, DRINK_DOTS_MAX)
          .map((fill, i) => (
            <DrinkDot key={i} size={12} fill={fill} />
          ))}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <button
          onClick={onClear}
          className="rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{ background: "transparent", color: C.brass }}
        >
          Clear
        </button>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{ background: "transparent", color: C.muted }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            className="rounded-lg px-4 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{ background: C.done, color: C.ground }}
          >
            Save
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// One editor for both kinds of entry. It holds a draft so a half-typed note or
// a momentarily empty time field never reaches the record, and so Cancel is a
// real cancel.
function EditDialog({
  title,
  eyebrow,
  time,
  note,
  focusNote,
  removeLabel,
  onSave,
  onRemove,
  onClose,
}) {
  const [draftTime, setDraftTime] = useState(time);
  const [draftNote, setDraftNote] = useState(note || "");

  const field =
    "mt-1 w-full rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white";
  const fieldStyle = {
    background: C.surfaceHi,
    color: C.chalk,
    border: "none",
  };

  return (
    <Dialog title={title} eyebrow={eyebrow} onClose={onClose}>
      <label className="mt-4 block text-sm" style={{ color: C.muted }}>
        Time
        <span
          className="mt-1 block w-full overflow-hidden rounded-lg focus-within:ring-2 focus-within:ring-white"
          style={{ background: C.surfaceHi }}
        >
          <input
            type="time"
            value={draftTime}
            onChange={(e) => setDraftTime(e.target.value)}
            className="block w-full min-w-0 max-w-full px-3 py-2 text-base focus:outline-none"
            style={{
              background: "transparent",
              color: C.chalk,
              border: "none",
              boxSizing: "border-box",
            }}
          />
        </span>
      </label>

      <label className="mt-4 block text-sm" style={{ color: C.muted }}>
        Notes
        <textarea
          autoFocus={focusNote}
          rows={3}
          value={draftNote}
          onChange={(e) => setDraftNote(e.target.value)}
          placeholder="Anything worth remembering"
          className={`${field} resize-none`}
          style={fieldStyle}
        />
      </label>

      <div className="mt-5 flex items-center justify-between gap-3">
        <button
          onClick={onRemove}
          className="rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{ background: "transparent", color: C.brass }}
        >
          {removeLabel}
        </button>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{ background: "transparent", color: C.muted }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({ time: draftTime, note: draftNote.trim() })}
            disabled={!draftTime}
            className="rounded-lg px-4 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
            style={{ background: C.done, color: C.ground }}
          >
            Save
          </button>
        </div>
      </div>
    </Dialog>
  );
}
