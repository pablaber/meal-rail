import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatDate } from "../day.js";
import { drinkCircles } from "../grade.js";
import { C, FONT } from "../theme.js";
import { DRINK_DOTS_MAX, DrinkDot } from "./HistoryStrip.jsx";

// Everything the browser will land on with Tab. `:not([disabled])` matters more
// than it looks: the confirm button spends its first five seconds disabled and
// the drink stepper's minus is disabled at zero, so a trap that included them
// would strand Tab on an element that can't take focus.
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const focusableIn = (panel) => [...panel.querySelectorAll(FOCUSABLE)];

// The shell both editors share — scrim, safe-area padding, Escape and a
// backdrop tap to close. Sharing it is what keeps the two looking alike.
//
// It also owns focus for every dialog in the app: where focus lands on open,
// keeping Tab inside while it is open, and handing focus back to whatever
// opened it on close. Doing that here rather than per dialog is what makes it
// true of all of them, including any added later.
//
// `initialFocus` is a ref to the control focus should land on. Without one
// focus goes to the panel itself, which is deliberate rather than lazy: a
// screen reader reads the dialog's name and role on arriving there, and the
// first control in tab order is not always somewhere you want to be dropped —
// in `EditDialog` it is the time field, and focusing that on a phone opens the
// time picker over a dialog the user has not read yet.
export function Dialog({
  title,
  eyebrow = "Editing",
  ariaLabel,
  initialFocus,
  onClose,
  children,
}) {
  const panelRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Mount only — the deps are empty on purpose. `initialFocus` is read once, on
  // the way in, and the element to hand focus back to is whatever held it when
  // the dialog opened, not whatever holds it on some later render.
  //
  // A layout effect rather than `useEffect` so focus has moved before the
  // browser paints the dialog, and so that a dialog opening as another closes
  // (Paste text → Review backup) sees the outgoing one's restore already done:
  // it captures the button in settings that started the pair, not the dead
  // button inside the dialog that has just been unmounted.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trigger = document.activeElement;

    const wanted = initialFocus?.current;
    if (wanted && !wanted.disabled && panel.contains(wanted)) wanted.focus();
    else panel.focus();

    return () => {
      // The trigger can be gone by now — a dialog is allowed to remove the
      // thing that opened it. Leaving focus where it is beats throwing it at a
      // detached node, which drops it on `body` and restarts Tab from the top.
      if (trigger instanceof HTMLElement && document.contains(trigger)) {
        trigger.focus();
      }
    };
  }, []);

  // Tab and Shift+Tab wrap within the panel. `aria-modal` tells a screen reader
  // the rest of the page is inert; nothing tells the Tab key, so this does.
  const onKeyDown = (e) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    const items = focusableIn(panel);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    // Focus sitting on the panel itself is the open state before the first Tab:
    // forwards it should fall through to `first`, backwards it has to wrap.
    const leaving = e.shiftKey
      ? active === first || active === panel
      : active === last;
    if (!leaving) return;
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  };

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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || `Edit ${title}`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl p-5 focus:outline-none"
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
export function ConfirmDialog({
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
  // Focus opens on Cancel, not the confirm: this dialog is only used for things
  // that can't be undone, so the destructive button is the one you should have
  // to travel to. It is also disabled while the pause runs, and there is
  // nothing to be gained by landing focus on a control that can't be pressed.
  const cancelRef = useRef(null);

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
    <Dialog
      title={title}
      eyebrow={eyebrow}
      ariaLabel={title}
      initialFocus={cancelRef}
      onClose={close}
    >
      <div className="mt-3 text-sm" style={{ color: C.muted }}>
        {message}
      </div>
      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          ref={cancelRef}
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

const countLabel = (count, singular, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

export function RestoreDialog({
  summary,
  onConfirm,
  onClose,
  damaged = false,
}) {
  const range = summary.dayCount
    ? summary.firstDay === summary.lastDay
      ? formatDate(summary.firstDay)
      : `${formatDate(summary.firstDay)} through ${formatDate(summary.lastDay)}`
    : "No logged dates";
  const entries = [
    countLabel(summary.checks, "checked meal"),
    countLabel(summary.snacks, "snack"),
    countLabel(summary.workouts, "workout snack"),
    countLabel(summary.drinks, "drink"),
  ].join(" · ");

  return (
    <ConfirmDialog
      title={damaged ? "Replace damaged data" : "Restore this backup?"}
      eyebrow="Review backup"
      message={
        <>
          <p>
            {countLabel(summary.dayCount, "logged day")} · {range}
          </p>
          <p className="mt-2">{entries}</p>
          <p className="mt-3" style={{ color: C.brass }}>
            This replaces all settings and logged days currently on this device.
            Back them up first if you may need them later.
          </p>
        </>
      }
      confirmLabel={damaged ? "Replace data" : "Restore backup"}
      armMs={0}
      onConfirm={onConfirm}
      onClose={onClose}
    />
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
export function PasteDialog({ onLoad, onClose }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  // The field is the whole dialog — opening it with the caret already there
  // saves a tap on the one screen where the keyboard is certainly wanted.
  const textRef = useRef(null);

  return (
    <Dialog
      title="Paste a backup"
      eyebrow="Restoring"
      ariaLabel="Restore a backup from pasted text"
      initialFocus={textRef}
      onClose={onClose}
    >
      <p className="mt-3 text-sm" style={{ color: C.muted }}>
        This replaces every day currently logged on this device.
      </p>

      <label className="mt-4 block text-sm" style={{ color: C.muted }}>
        Backup text
        <textarea
          ref={textRef}
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
          Review backup
        </button>
      </div>
    </Dialog>
  );
}

// The pill downstairs only counts up. Coming back down happens here, where it
// takes a deliberate visit — and a draft, so Cancel is a real cancel.
export function DrinkDialog({ count, eyebrow, onSave, onClear, onClose }) {
  const [draft, setDraft] = useState(count);
  const minusRef = useRef(null);
  const plusRef = useRef(null);

  const step =
    "flex h-11 w-11 items-center justify-center rounded-full text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40";
  const stepStyle = { background: C.surfaceHi, color: C.chalk };

  return (
    <Dialog
      title="Drinks"
      eyebrow={eyebrow}
      // The stepper is why anyone is here, so focus opens on it — minus, since
      // the pill downstairs only counts up and this is where it comes down.
      // Read once, on mount, so `draft` is still `count`: at zero minus is
      // disabled and plus is the only thing the dialog can usefully do.
      initialFocus={draft === 0 ? plusRef : minusRef}
      onClose={onClose}
    >
      <div className="mt-5 flex items-center justify-center gap-6">
        <button
          ref={minusRef}
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
          ref={plusRef}
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
export function EditDialog({
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
  const noteRef = useRef(null);

  const field =
    "mt-1 w-full rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white";
  const fieldStyle = {
    background: C.surfaceHi,
    color: C.chalk,
    border: "none",
  };

  return (
    <Dialog
      title={title}
      eyebrow={eyebrow}
      // Only when the dialog opened to take a note. Otherwise focus stays on
      // the panel: the first control is the time field, and dropping a phone
      // straight into its picker buries a dialog that was opened to uncheck
      // something. Handing this to `Dialog` rather than the textarea's own
      // `autoFocus` keeps one thing deciding where focus starts, which is what
      // lets `Dialog` capture the trigger to return it to.
      initialFocus={focusNote ? noteRef : undefined}
      onClose={onClose}
    >
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
          ref={noteRef}
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
