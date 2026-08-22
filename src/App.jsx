import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { C, FONT } from "./theme.js";
import {
  load,
  save,
  clear,
  exportRawFile,
  importFile,
  exportRawClipboard,
  importText,
  summarizeBackup,
} from "./storage.js";
import {
  dayBadge,
  daySummary,
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
import {
  DEFAULT_SLOTS,
  applyPlanChange,
  nextSlotId,
  planFor,
  removePlan,
  slotsFor,
} from "./plans.js";
import {
  HISTORY_VIEWS,
  resumableDayEdit,
  useHistoryView,
} from "./useHistoryView.js";
import { CalendarScreen } from "./screens/CalendarScreen.jsx";
import { SettingsScreen } from "./screens/SettingsScreen.jsx";
import { StripSettingsScreen } from "./screens/StripSettingsScreen.jsx";
import { FitHeading, PastDay, PastDayEditor } from "./screens/DayScreens.jsx";
import {
  HistoryStrip,
  STRIP_GRADE_OPTIONS,
  STRIP_MARK_OPTIONS,
} from "./components/HistoryStrip.jsx";
import {
  ConfirmDialog,
  Dialog,
  DrinkDialog,
  EditDialog,
  PasteDialog,
  RestoreDialog,
} from "./components/Dialogs.jsx";
import { DayRail } from "./components/DayRail.jsx";
import { Screen, StatusLine } from "./components/Screen.jsx";

const DEFAULTS = {
  plans: [{ from: dayKey(), slots: DEFAULT_SLOTS }],
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

const DATA_BUTTON_CLASS =
  "w-full rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white";
const DATA_BUTTON_STYLE = { background: C.surfaceHi, color: C.chalk };

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
  const [settingsOverlayOpen, setSettingsOverlayOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  // A past day is edited against a draft rather than written through on every
  // tap the way today is. Today is the day you are living: a tap is the record.
  // A past day is a reconstruction, and a reconstruction wants a Save.
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [planDraft, setPlanDraft] = useState(null);
  const [planDirty, setPlanDirty] = useState(false);
  const [confirmPlanDiscard, setConfirmPlanDiscard] = useState(false);
  const [planStartChoice, setPlanStartChoice] = useState(false);
  const [confirmCancelUpcoming, setConfirmCancelUpcoming] = useState(null);
  const planSavingRef = useRef(false);

  const {
    view,
    selectedDay,
    pushView,
    back: goBack,
    dayEdit: dayHistoryEdit,
    planEdit: planHistoryEdit,
  } = useHistoryView({
    onDayEditExit: () => {
      setDraft(null);
      setDirty(false);
    },
    onDayEditDiscard: () => setConfirmDiscard(true),
    onPlanEditExit: () => {
      setPlanDraft(null);
      setPlanDirty(false);
    },
    onPlanEditDiscard: () => setConfirmPlanDiscard(true),
    onPop: () => {
      setEditing(null);
      setPlanStartChoice(false);
      setConfirmPlanDiscard(false);
      setConfirmCancelUpcoming(null);
    },
  });

  // Load
  useEffect(() => {
    let alive = true;
    (async () => {
      const parsed = await load();
      // Strict Mode mounts, cleans up, and mounts this effect again in
      // development. The abandoned async run must not reconcile history after
      // its cleanup: doing so strips the edit flag before the live run can
      // restore the editor and leaves a duplicate read-only entry on top.
      if (!alive) return;
      const loadedDays =
        parsed.status === "valid" ? parsed.state.days || {} : {};
      if (parsed.status === "valid") {
        setSettings({ ...DEFAULTS, ...(parsed.state.settings || {}) });
        setDays(loadedDays);
      } else if (parsed.status === "unreadable") {
        setRecovery(parsed);
      }
      // Reload keeps the current history entry. If it is a valid past-day edit,
      // rebuild a clean draft from the durable record and reactivate the pop
      // guard so the first Back returns to the read-only day. An edit entry we
      // can no longer honor loses only its stale `edit` flag.
      const resumedDay = resumableDayEdit(window.history.state, today);
      if (resumedDay && parsed.status !== "unreadable") {
        setDraft({
          key: resumedDay,
          record: loadedDays[resumedDay] || BLANK_DAY,
        });
        setDirty(false);
        dayHistoryEdit.resume(resumedDay);
      } else if (
        window.history.state?.view === "day" &&
        window.history.state?.edit
      ) {
        dayHistoryEdit.replaceStale();
      }
      if (window.history.state?.view === "plan" && window.history.state?.edit) {
        window.history.replaceState({ view: "plan" }, "");
      }
      setReady(true);
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
    pushView("settings");
  };

  const openPlanSettings = () => {
    pushView("plan");
  };

  // Its own history entry on top of settings, so back lands where you came
  // from rather than at the day view.
  const openStripSettings = () => {
    pushView("strip");
  };

  const openCalendar = () => {
    pushView("calendar");
  };

  const openPastDay = (key) => {
    if (key >= today) return;
    pushView("day", { day: key });
  };

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
      if (
        editing ||
        confirmDiscard ||
        confirmPlanDiscard ||
        planStartChoice ||
        confirmCancelUpcoming ||
        settingsOverlayOpen
      )
        return;
      if (planDraft) cancelPlanEdit();
      else if (draft) cancelEdit();
      else goBack();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    view,
    editing,
    confirmDiscard,
    confirmPlanDiscard,
    planStartChoice,
    confirmCancelUpcoming,
    settingsOverlayOpen,
    planDraft,
    draft,
  ]);

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
    return ok;
  }, []);

  const plans = settings.plans;
  const currentPlan = planFor(plans, today);
  const tomorrow = shiftDay(today, 1);
  const upcomingPlan = plans.find((plan) => plan.from === tomorrow) || null;

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
  const activeSlots = slotsFor(plans, activeKey);

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
      (editingPast
        ? plannedBase(activeRecord, activeSlots)
        : activeSlots.length) + workouts.length;

    if (editingPast) {
      dayHistoryEdit.markDirty();
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
    return persist(next, days);
  };

  const startPlanEdit = (plan = currentPlan, editingUpcoming = false) => {
    const slots = plan.slots.map((slot) => ({ ...slot }));
    setPlanDraft({
      baseDay: today,
      from: editingUpcoming ? tomorrow : today,
      slots,
      editingUpcoming,
    });
    setPlanDirty(false);
    planHistoryEdit.start();
  };

  const updatePlanSlots = (change) => {
    planHistoryEdit.markDirty();
    setPlanDirty(true);
    setPlanDraft((draft) => ({
      ...draft,
      slots: change(draft.slots),
    }));
  };

  const leavePlanEdit = () => {
    planHistoryEdit.finish();
    setPlanDraft(null);
    setPlanDirty(false);
    setConfirmPlanDiscard(false);
    setPlanStartChoice(false);
    goBack();
  };

  const cancelPlanEdit = () => {
    if (planHistoryEdit.isDirty()) setConfirmPlanDiscard(true);
    else leavePlanEdit();
  };

  const commitPlanChange = async ({ from, slots, eraseToday = false }) => {
    if (planSavingRef.current) return false;
    if (!planDraft || planDraft.baseDay !== today) {
      showNotice("The date changed — review the meal plan again.", {
        failed: true,
      });
      leavePlanEdit();
      return false;
    }
    planSavingRef.current = true;

    const cleanSlots = slots.map((slot) => ({
      ...slot,
      label: slot.label.trim(),
    }));
    const applied = applyPlanChange(settingsRef.current.plans, days, {
      from,
      slots: cleanSlots,
      removeDay:
        eraseToday || (from === today && isEmptyDay(days[today] || BLANK_DAY))
          ? today
          : null,
    });
    const nextSettings = {
      ...settingsRef.current,
      plans: applied.plans,
    };
    const nextDays = applied.days;

    const ok = await persist(nextSettings, nextDays);
    planSavingRef.current = false;
    if (!ok) return false;

    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    setDays(nextDays);
    showNotice(
      from === tomorrow ? "Plan starts tomorrow" : "Meal plan changed",
    );
    leavePlanEdit();
    return true;
  };

  const savePlanDraft = () => {
    if (!planDraft || planDraft.slots.some((slot) => !slot.label.trim()))
      return;
    if (planDraft.baseDay !== today) {
      commitPlanChange({
        from: planDraft.from,
        slots: planDraft.slots,
      });
      return;
    }
    if (planDraft.editingUpcoming) {
      commitPlanChange({ from: tomorrow, slots: planDraft.slots });
    } else if (isEmptyDay(days[today] || BLANK_DAY)) {
      commitPlanChange({ from: today, slots: planDraft.slots });
    } else {
      setPlanStartChoice(true);
    }
  };

  const cancelUpcomingPlan = async () => {
    const target = confirmCancelUpcoming;
    if (!target) return;
    if (target.baseDay !== today || target.from !== shiftDay(today, 1)) {
      setConfirmCancelUpcoming(null);
      showNotice("The date changed — review the meal plan again.", {
        failed: true,
      });
      return;
    }

    const nextSettings = {
      ...settingsRef.current,
      plans: removePlan(settingsRef.current.plans, target.from),
    };
    const ok = await persist(nextSettings, days);
    if (!ok) return;
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    setConfirmCancelUpcoming(null);
    showNotice("Upcoming plan cancelled");
  };

  useEffect(() => {
    if (!planDraft || planDraft.baseDay === today) return;
    planHistoryEdit.finish();
    setPlanDraft(null);
    setPlanDirty(false);
    setConfirmPlanDiscard(false);
    setPlanStartChoice(false);
    showNotice("The date changed — review the meal plan again.", {
      failed: true,
    });
    goBack();
  }, [planDraft, showNotice, today]);

  // Both ways in end here. A restore replaces everything — in state and on disk
  // — whichever way the JSON arrived, so a file and a paste can't drift into
  // meaning two different things.
  const restoreBackup = async (parsed) => {
    const nextSettings = { ...DEFAULTS, ...(parsed.settings || {}) };
    const nextDays = trimDays(parsed.days || {});
    const ok = await persist(nextSettings, nextDays);
    if (!ok) {
      showNotice("Couldn't restore — this browser is blocking storage.", {
        failed: true,
      });
      return false;
    }
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    setDays(nextDays);
    showNotice("Backup restored");
    return true;
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
    setDraft({ key, record: days[key] || BLANK_DAY });
    setDirty(false);
    dayHistoryEdit.start(key);
  };

  // Drops the guard before walking back, so the pop this causes is let through
  // rather than turned into another question.
  const leaveEdit = () => {
    dayHistoryEdit.finish();
    setDraft(null);
    setDirty(false);
    setEditing(null);
    setConfirmDiscard(false);
    goBack();
  };

  const cancelEdit = () => {
    if (dayHistoryEdit.isDirty()) setConfirmDiscard(true);
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

  const recentDays = useMemo(() => {
    const out = [];
    for (let i = 13; i >= 0; i--) {
      const k = shiftDay(today, -i);
      const dow = dateAt(k).getDay();
      out.push({
        ...daySummary(days, k, slotsFor(plans, k).length, k === today),
        isWeekend: dow === 0 || dow === 6,
      });
    }
    return out;
  }, [days, plans, today]);

  // Contiguous runs of weekend days in the strip, as column indices. Usually
  // one or two full Saturday+Sunday pairs, but a run can be a single day when
  // the fourteen-day window starts or ends mid-weekend. The backdrop drawn
  // behind the strip is one shape per run rather than one per day, so the
  // weekend reads as a unit.
  const weekendSpans = useMemo(() => {
    const spans = [];
    recentDays.forEach((d, idx) => {
      if (!d.isWeekend) return;
      const last = spans[spans.length - 1];
      if (last && last.end === idx - 1) last.end = idx;
      else spans.push({ start: idx, end: idx });
    });
    return spans;
  }, [recentDays]);

  const selectedDayRecord = selectedDay ? days[selectedDay] : null;
  const selectedDaySlots = selectedDay
    ? slotsFor(plans, selectedDay)
    : currentPlan.slots;
  const selectedDaySummary = selectedDay
    ? daySummary(days, selectedDay, selectedDaySlots.length, false)
    : null;

  // The draft's grade, recomputed as it is edited, so a correction shows what
  // it does to the day before it is committed.
  const draftGrade = draft
    ? dayBadge(summarize(draft.record, activeSlots.length))
    : null;

  const weekExtras = recentDays.slice(7).reduce((a, d) => a + d.extra, 0);
  const weekDrinks = recentDays.slice(7).reduce((a, d) => a + d.drinks, 0);

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
    slots: activeSlots,
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
            {recoveryConfirm?.kind === "reset" && (
              <ConfirmDialog
                title="Reset Meal Rail"
                message="This permanently deletes the damaged saved value. Export or copy it first if you may need it later."
                confirmLabel="Reset everything"
                onClose={() => setRecoveryConfirm(null)}
                onConfirm={resolveRecovery}
              />
            )}
            {recoveryConfirm?.kind === "replace" && (
              <RestoreDialog
                damaged
                summary={summarizeBackup(recoveryConfirm.parsed)}
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
                    if (parsed) setRecoveryConfirm({ kind: "replace", parsed });
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
      <SettingsScreen
        settings={settings}
        days={days}
        currentPlan={currentPlan}
        stripMarkLabel={stripMarkLabel}
        stripGradeLabel={stripGradeLabel}
        saving={saving}
        saveError={saveError}
        notice={notice}
        onBack={goBack}
        onOpenPlan={openPlanSettings}
        onOpenStrip={openStripSettings}
        onPatchSettings={patchSettings}
        onRestoreBackup={restoreBackup}
        onDaysCleared={() => setDays({})}
        onShowNotice={showNotice}
        onOverlayChange={setSettingsOverlayOpen}
      />
    );
  }

  if (view === "plan") {
    const previousPlans = plans
      .filter((plan) => plan.from < currentPlan.from)
      .slice()
      .reverse();
    const planStatus = (
      <StatusLine saveError={saveError} notice={notice} saving={saving} />
    );

    if (planDraft) {
      return (
        <MealPlanEditor
          slots={planDraft.slots}
          dirty={planDirty}
          saving={saving}
          editingUpcoming={planDraft.editingUpcoming}
          onBack={cancelPlanEdit}
          onSave={savePlanDraft}
          onRename={(id, label) =>
            updatePlanSlots((slots) =>
              slots.map((slot) => (slot.id === id ? { ...slot, label } : slot)),
            )
          }
          onMove={(index, delta) =>
            updatePlanSlots((slots) => {
              const next = slots.slice();
              const [slot] = next.splice(index, 1);
              next.splice(index + delta, 0, slot);
              return next;
            })
          }
          onRetire={(id) =>
            updatePlanSlots((slots) => slots.filter((slot) => slot.id !== id))
          }
          onAdd={() =>
            updatePlanSlots((slots) => [
              ...slots,
              {
                id: nextSlotId([...plans, { from: "draft", slots }], days),
                label: "",
              },
            ])
          }
          status={planStatus}
          overlay={
            <>
              {planStartChoice && (
                <PlanStartDialog
                  onClose={() => setPlanStartChoice(false)}
                  onTomorrow={() =>
                    commitPlanChange({
                      from: tomorrow,
                      slots: planDraft.slots,
                    })
                  }
                  onToday={() =>
                    commitPlanChange({
                      from: today,
                      slots: planDraft.slots,
                      eraseToday: true,
                    })
                  }
                />
              )}
              {confirmPlanDiscard && (
                <ConfirmDialog
                  title="Discard plan changes"
                  eyebrow="Unsaved changes"
                  message="Leaving now loses the changes in this meal plan draft."
                  confirmLabel="Discard"
                  armMs={0}
                  onClose={() => setConfirmPlanDiscard(false)}
                  onConfirm={leavePlanEdit}
                />
              )}
            </>
          }
        />
      );
    }

    return (
      <MealPlanScreen
        currentPlan={currentPlan}
        upcomingPlan={upcomingPlan}
        previousPlans={previousPlans}
        onBack={goBack}
        onChange={() => startPlanEdit(currentPlan, false)}
        onEditUpcoming={() => startPlanEdit(upcomingPlan, true)}
        onCancelUpcoming={() =>
          setConfirmCancelUpcoming({ from: upcomingPlan.from, baseDay: today })
        }
        status={planStatus}
        overlay={
          confirmCancelUpcoming && (
            <ConfirmDialog
              title="Cancel upcoming plan"
              eyebrow="Upcoming change"
              message="Your current meal plan will continue tomorrow instead."
              confirmLabel="Cancel change"
              armMs={0}
              onClose={() => setConfirmCancelUpcoming(null)}
              onConfirm={cancelUpcomingPlan}
            />
          )
        }
      />
    );
  }

  if (view === "strip") {
    return (
      <StripSettingsScreen
        stripMark={stripMark}
        stripGrade={stripGrade}
        saving={saving}
        saveError={saveError}
        notice={notice}
        onBack={goBack}
        onPatchSettings={patchSettings}
      />
    );
  }

  if (view === "calendar") {
    return (
      <CalendarScreen
        days={days}
        plans={plans}
        today={today}
        onBack={goBack}
        onOpenDay={openPastDay}
      />
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
        slots={selectedDaySlots}
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

      <HistoryStrip
        recentDays={recentDays}
        weekendSpans={weekendSpans}
        mark={stripMark}
        grade={stripGrade}
        weekExtras={weekExtras}
        weekDrinks={weekDrinks}
        onOpenDay={openPastDay}
        saveError={saveError}
        notice={notice}
        saving={saving}
      />
    </Screen>
  );
}

function MealPlanScreen({
  currentPlan,
  upcomingPlan,
  previousPlans,
  onBack,
  onChange,
  onEditUpcoming,
  onCancelUpcoming,
  status,
  overlay,
}) {
  return (
    <Screen overlay={overlay}>
      <header className="flex items-start gap-3">
        <button
          onClick={onBack}
          aria-label="Back to settings"
          className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{ background: C.surface }}
        >
          <IconBack color={C.chalk} />
        </button>
        <div>
          <h1
            className="text-3xl leading-tight"
            style={{ fontFamily: FONT.display }}
          >
            Meal plan
          </h1>
          <p className="mt-2 text-sm" style={{ color: C.muted }}>
            Changes apply today and going forward. Past days keep the plan they
            used.
          </p>
        </div>
      </header>

      <section className="mt-8">
        <p
          className="text-xs uppercase tracking-widest"
          style={{ color: C.muted, fontFamily: FONT.mono }}
        >
          Current plan
        </p>
        <PlanCard plan={currentPlan} />
        {!upcomingPlan && (
          <button
            onClick={onChange}
            className="mt-3 w-full rounded-lg px-4 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{ background: C.done, color: C.ground }}
          >
            Change plan
          </button>
        )}
      </section>

      {upcomingPlan && (
        <section
          className="mt-6 pt-6"
          style={{ borderTop: `1px solid ${C.rail}` }}
        >
          <p
            className="text-xs uppercase tracking-widest"
            style={{ color: C.brass, fontFamily: FONT.mono }}
          >
            Upcoming plan · starts tomorrow
          </p>
          <PlanCard plan={upcomingPlan} />
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={onEditUpcoming}
              className="flex-1 rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ background: C.surfaceHi, color: C.chalk }}
            >
              Edit upcoming plan
            </button>
            <button
              onClick={onCancelUpcoming}
              className="rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ background: "transparent", color: C.red }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {previousPlans.length > 0 && (
        <section
          className="mt-6 pt-6"
          style={{ borderTop: `1px solid ${C.rail}` }}
        >
          <p
            className="text-xs uppercase tracking-widest"
            style={{ color: C.muted, fontFamily: FONT.mono }}
          >
            Previous plans
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {previousPlans.map((plan) => (
              <div key={plan.from}>
                <p
                  className="text-xs"
                  style={{ color: C.faintText, fontFamily: FONT.mono }}
                >
                  From {formatDateShort(plan.from)}
                </p>
                <p className="mt-1 text-sm" style={{ color: C.muted }}>
                  {plan.slots.map((slot) => slot.label).join(" · ")}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-auto pt-6">{status}</div>
    </Screen>
  );
}

function PlanCard({ plan }) {
  return (
    <ol
      className="mt-3 flex flex-col gap-2 rounded-xl px-4 py-3"
      style={{ background: C.surface }}
    >
      {plan.slots.map((slot, index) => (
        <li key={slot.id} className="flex items-center gap-3 text-sm">
          <span
            className="text-xs"
            style={{ color: C.faintText, fontFamily: FONT.mono }}
          >
            {index + 1}
          </span>
          <span>{slot.label}</span>
        </li>
      ))}
    </ol>
  );
}

function MealPlanEditor({
  slots,
  dirty,
  saving,
  editingUpcoming,
  onBack,
  onSave,
  onRename,
  onMove,
  onRetire,
  onAdd,
  status,
  overlay,
}) {
  const invalid = slots.some((slot) => !slot.label.trim());
  return (
    <Screen overlay={overlay}>
      <header className="flex items-start gap-3">
        <button
          onClick={onBack}
          aria-label="Cancel meal plan changes"
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
            {editingUpcoming ? "Starts tomorrow" : "Meal plan"}
            {dirty ? " · Unsaved changes" : ""}
          </p>
          <h1
            className="mt-1 text-3xl leading-tight"
            style={{ fontFamily: FONT.display }}
          >
            {editingUpcoming ? "Edit upcoming plan" : "Change plan"}
          </h1>
        </div>
      </header>

      <section className="mt-8">
        <p className="text-sm" style={{ color: C.muted }}>
          Rename meals, put them in order, or retire ones you no longer plan.
        </p>
        <ol className="mt-4 flex flex-col gap-3">
          {slots.map((slot, index) => (
            <li
              key={slot.id}
              className="rounded-xl p-3"
              style={{ background: C.surface }}
            >
              <label
                className="block text-xs"
                style={{ color: C.muted, fontFamily: FONT.mono }}
              >
                Meal {index + 1}
                <input
                  value={slot.label}
                  onChange={(event) => onRename(slot.id, event.target.value)}
                  placeholder="Meal name"
                  className="mt-1 w-full rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  style={{
                    background: C.surfaceHi,
                    color: C.chalk,
                    border: "none",
                  }}
                />
              </label>
              <div className="mt-2 flex items-center justify-end gap-1">
                <button
                  onClick={() => onMove(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${slot.label || `meal ${index + 1}`} earlier`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30"
                  style={{ background: C.surfaceHi, color: C.chalk }}
                >
                  ↑
                </button>
                <button
                  onClick={() => onMove(index, 1)}
                  disabled={index === slots.length - 1}
                  aria-label={`Move ${slot.label || `meal ${index + 1}`} later`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30"
                  style={{ background: C.surfaceHi, color: C.chalk }}
                >
                  ↓
                </button>
                <button
                  onClick={() => onRetire(slot.id)}
                  disabled={slots.length === 1}
                  aria-label={`Retire ${slot.label || `meal ${index + 1}`}`}
                  className="ml-2 rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30"
                  style={{ background: "transparent", color: C.red }}
                >
                  Retire
                </button>
              </div>
            </li>
          ))}
        </ol>

        <button
          onClick={onAdd}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{ background: C.surfaceHi, color: C.chalk }}
        >
          <IconPlus color={C.done} />
          Add meal
        </button>
        {invalid && (
          <p
            className="mt-2 text-xs"
            style={{ color: C.brass, fontFamily: FONT.mono }}
            role="alert"
          >
            Give every meal a name before saving.
          </p>
        )}
      </section>

      <div className="mt-auto pt-8">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onBack}
            className="rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{ background: "transparent", color: C.muted }}
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!dirty || invalid || saving}
            aria-busy={saving}
            className="rounded-lg px-4 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
            style={{ background: C.done, color: C.ground }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        {status}
      </div>
    </Screen>
  );
}

function PlanStartDialog({ onClose, onTomorrow, onToday }) {
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  // The option that keeps today's entries, which is also the first one listed.
  const tomorrowRef = useRef(null);

  const choose = async (action) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    const ok = await action();
    if (!ok) {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const close = () => {
    if (!submittingRef.current) onClose();
  };

  return (
    <Dialog
      title="Today already has entries"
      eyebrow="Choose when to start"
      ariaLabel="Choose when the new meal plan starts"
      initialFocus={tomorrowRef}
      onClose={close}
    >
      <p className="mt-3 text-sm" style={{ color: C.muted }}>
        You’ve already logged entries today. To start this plan today, Meal Rail
        must erase today’s entries so the day uses one plan from start to
        finish.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <button
          ref={tomorrowRef}
          onClick={() => choose(onTomorrow)}
          disabled={submitting}
          aria-busy={submitting}
          className="w-full rounded-lg px-4 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
          style={{ background: C.done, color: C.ground }}
        >
          Start tomorrow
        </button>
        <button
          onClick={() => choose(onToday)}
          disabled={submitting}
          className="w-full rounded-lg px-4 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
          style={{ background: C.red, color: C.ground }}
        >
          Erase today &amp; start now
        </button>
        <button
          onClick={close}
          disabled={submitting}
          className="w-full rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
          style={{ background: "transparent", color: C.muted }}
        >
          Cancel
        </button>
      </div>
    </Dialog>
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
