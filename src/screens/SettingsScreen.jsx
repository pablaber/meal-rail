import { useEffect, useState } from "react";
import {
  clear,
  exportClipboard,
  exportFile,
  importFile,
  importText,
} from "../storage.js";
import { BUILD_ID, checkForUpdate } from "../update.js";
import { C, FONT } from "../theme.js";
import { ConfirmDialog, PasteDialog } from "../components/Dialogs.jsx";
import { Screen, StatusLine } from "../components/Screen.jsx";

const DATA_BUTTON_CLASS =
  "w-full rounded-lg px-3 py-2 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-white";
const DATA_BUTTON_STYLE = { background: C.surfaceHi, color: C.chalk };

export function SettingsScreen({
  settings,
  days,
  currentPlan,
  stripMarkLabel,
  stripGradeLabel,
  saving,
  saveError,
  notice,
  onBack,
  onOpenPlan,
  onOpenStrip,
  onPatchSettings,
  onRestoreBackup,
  onDaysCleared,
  onShowNotice,
  onOverlayChange,
}) {
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const patchSettings = onPatchSettings;
  const restoreBackup = onRestoreBackup;
  const showNotice = onShowNotice;

  useEffect(() => {
    onOverlayChange(confirmClearOpen || pasteOpen);
    return () => onOverlayChange(false);
  }, [confirmClearOpen, onOverlayChange, pasteOpen]);

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
                onDaysCleared();
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

        <button
          onClick={onOpenPlan}
          className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <span className="min-w-0">
            <span className="block text-sm">Meal plan</span>
            <span
              className="mt-0.5 block truncate text-xs"
              style={{ color: C.muted }}
            >
              {currentPlan.slots.map((slot) => slot.label).join(" · ")}
            </span>
          </span>
          <IconChevronRight color={C.muted} />
        </button>

        <label className="mt-4 flex items-center justify-between gap-3 text-sm">
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
          onClick={onOpenStrip}
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
          Every day you've logged lives on this device alone. A file is what you
          keep; text is for moving a backup somewhere a file can't go.
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
              else showNotice("Couldn't reach the clipboard", { failed: true });
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

function IconBack({ color }) {
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
      width="18"
      height="18"
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
