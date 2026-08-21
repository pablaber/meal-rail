import { useEffect, useRef, useState } from "react";
import { drinkCircles } from "../grade.js";
import { C, FONT } from "../theme.js";
import { DRINK_DOTS_MAX, DrinkDot } from "./HistoryStrip.jsx";

// The shell both editors share — scrim, safe-area padding, Escape and a
// backdrop tap to close. Sharing it is what keeps the two looking alike.
export function Dialog({
  title,
  eyebrow = "Editing",
  ariaLabel,
  onClose,
  children,
}) {
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
export function PasteDialog({ onLoad, onClose }) {
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
export function DrinkDialog({ count, eyebrow, onSave, onClear, onClose }) {
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
