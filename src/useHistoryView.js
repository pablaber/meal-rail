import { useCallback, useEffect, useRef, useState } from "react";
import { RETENTION_DAYS, dateAt, dayKey, shiftDay } from "./day.js";

// Screens that participate in the browser's history. Keeping the list beside
// the history adapter makes reload and popstate validation use the same source.
export const HISTORY_VIEWS = ["settings", "calendar", "day", "strip", "plan"];

const initialView = () => {
  const view = window.history.state?.view;
  return HISTORY_VIEWS.includes(view) ? view : "today";
};

export function resumableDayEdit(state, today) {
  if (
    state?.view !== "day" ||
    state.edit !== true ||
    typeof state.day !== "string" ||
    dayKey(dateAt(state.day)) !== state.day
  ) {
    return null;
  }
  return state.day < today && state.day >= shiftDay(today, -RETENTION_DAYS)
    ? state.day
    : null;
}

export function warnBeforeUnload(edit, event) {
  if (!edit.dirty) return false;
  event.preventDefault();
  event.returnValue = "";
  return true;
}

// Meal Rail deliberately uses the platform history directly instead of a
// router. This hook owns that boundary, including the edit entries that may
// refuse a pop when they contain unsaved work.
export function useHistoryView({
  onPop,
  onDayEditExit,
  onDayEditDiscard,
  onPlanEditExit,
  onPlanEditDiscard,
}) {
  const [view, setView] = useState(initialView);
  const [selectedDay, setSelectedDay] = useState(
    () => window.history.state?.day || null,
  );
  const callbacks = useRef({});
  callbacks.current = {
    onPop,
    onDayEditExit,
    onDayEditDiscard,
    onPlanEditExit,
    onPlanEditDiscard,
  };

  // These mirrors are updated by the writing handlers before React renders,
  // so a same-frame Back cannot slip past a newly dirty draft.
  const dayEdit = useRef({ active: false, dirty: false, key: null });
  const planEdit = useRef({ active: false, dirty: false });

  useEffect(() => {
    const handlePop = (event) => {
      if (
        planEdit.current.active &&
        !(event.state?.view === "plan" && event.state?.edit)
      ) {
        if (planEdit.current.dirty) {
          window.history.pushState({ view: "plan", edit: true }, "");
          callbacks.current.onPlanEditDiscard();
          return;
        }
        planEdit.current = { active: false, dirty: false };
        callbacks.current.onPlanEditExit();
      }

      if (dayEdit.current.active && !event.state?.edit) {
        if (dayEdit.current.dirty) {
          window.history.pushState(
            { view: "day", day: dayEdit.current.key, edit: true },
            "",
          );
          callbacks.current.onDayEditDiscard();
          return;
        }
        dayEdit.current = { active: false, dirty: false, key: null };
        callbacks.current.onDayEditExit();
      }

      const nextView = event.state?.view;
      setSelectedDay(nextView === "day" ? event.state?.day || null : null);
      setView(HISTORY_VIEWS.includes(nextView) ? nextView : "today");
      callbacks.current.onPop();
    };

    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event) =>
      warnBeforeUnload(dayEdit.current, event);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const pushView = useCallback((nextView, state = {}) => {
    const nextState = { view: nextView, ...state };
    window.history.pushState(nextState, "");
    setSelectedDay(nextView === "day" ? nextState.day || null : null);
    setView(nextView);
  }, []);

  const back = useCallback(() => window.history.back(), []);

  const startDayEdit = useCallback((key) => {
    dayEdit.current = { active: true, dirty: false, key };
    window.history.pushState({ view: "day", day: key, edit: true }, "");
  }, []);
  const resumeDayEdit = useCallback((key) => {
    dayEdit.current = { active: true, dirty: false, key };
  }, []);
  const replaceStaleDayEdit = useCallback(() => {
    dayEdit.current = { active: false, dirty: false, key: null };
    const state = window.history.state;
    if (state?.view !== "day" || !state.edit) return;
    const { edit: _edit, ...readOnlyState } = state;
    window.history.replaceState(readOnlyState, "");
  }, []);
  const markDayEditDirty = useCallback(() => {
    dayEdit.current.dirty = true;
  }, []);
  const finishDayEdit = useCallback(() => {
    dayEdit.current = { active: false, dirty: false, key: null };
  }, []);
  const isDayEditDirty = useCallback(() => dayEdit.current.dirty, []);

  const startPlanEdit = useCallback(() => {
    planEdit.current = { active: true, dirty: false };
    window.history.pushState({ view: "plan", edit: true }, "");
  }, []);
  const markPlanEditDirty = useCallback(() => {
    planEdit.current.dirty = true;
  }, []);
  const finishPlanEdit = useCallback(() => {
    planEdit.current = { active: false, dirty: false };
  }, []);
  const isPlanEditDirty = useCallback(() => planEdit.current.dirty, []);

  return {
    view,
    selectedDay,
    pushView,
    back,
    dayEdit: {
      start: startDayEdit,
      resume: resumeDayEdit,
      replaceStale: replaceStaleDayEdit,
      markDirty: markDayEditDirty,
      finish: finishDayEdit,
      isDirty: isDayEditDirty,
    },
    planEdit: {
      start: startPlanEdit,
      markDirty: markPlanEditDirty,
      finish: finishPlanEdit,
      isDirty: isPlanEditDirty,
    },
  };
}
