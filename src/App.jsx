import { useState, useEffect, useMemo, useCallback } from "react";
import { C, FONT } from "./theme.js";
import { load, save, clear, exportFile, importFile } from "./storage.js";
import { BUILD_ID, checkForUpdate } from "./update.js";

const DEFAULTS = {
  slots: [
    { id: "s1", label: "Breakfast" },
    { id: "s2", label: "Lunch" },
    { id: "s3", label: "Snack" },
    { id: "s4", label: "Dinner" },
  ],
  trainingEnabled: true,
  trainingLabel: "Training fuel",
};

const dayKey = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const shiftDay = (key, delta) => {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return dayKey(dt);
};

const clock = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

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
  return new Date(y, m - 1, d, hh, mm, prev.getSeconds(), prev.getMilliseconds()).toISOString();
};

const uid = () => Math.random().toString(36).slice(2, 9);

export default function MealRail() {
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [notice, setNotice] = useState("");
  const [settings, setSettings] = useState(DEFAULTS);
  const [days, setDays] = useState({});
  const [today, setToday] = useState(dayKey());
  const [panel, setPanel] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [editing, setEditing] = useState(null);

  // Load
  useEffect(() => {
    let alive = true;
    (async () => {
      const parsed = await load();
      if (alive && parsed) {
        setSettings({ ...DEFAULTS, ...(parsed.settings || {}) });
        setDays(parsed.days || {});
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

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
    const trimmed = {};
    const cutoff = shiftDay(dayKey(), -400);
    Object.keys(nextDays).forEach((k) => {
      if (k >= cutoff) trimmed[k] = nextDays[k];
    });
    const ok = await save({ settings: nextSettings, days: trimmed });
    setSaveError(!ok);
    setSaving(false);
  }, []);

  const record = days[today] || { checks: {}, notes: {}, unplanned: [], training: false };

  const slots = useMemo(() => {
    const base = settings.slots;
    if (settings.trainingEnabled && record.training) {
      return [...base, { id: "__training", label: settings.trainingLabel }];
    }
    return base;
  }, [settings, record.training]);

  const writeDay = (patch) => {
    const next = { ...days, [today]: { ...record, ...patch } };
    next[today].planned = (patch.training ?? record.training) && settings.trainingEnabled
      ? settings.slots.length + 1
      : settings.slots.length;
    setDays(next);
    persist(settings, next);
  };

  const writeSettings = (next) => {
    setSettings(next);
    persist(next, days);
  };

  const check = (id) => writeDay({ checks: { ...record.checks, [id]: new Date().toISOString() } });

  const uncheck = (id) => {
    const checks = { ...record.checks };
    const notes = { ...(record.notes || {}) };
    delete checks[id];
    delete notes[id];
    writeDay({ checks, notes });
  };

  const editCheck = (id, { time, note }) => {
    const notes = { ...(record.notes || {}) };
    if (note) notes[id] = note;
    else delete notes[id];
    writeDay({
      checks: { ...record.checks, [id]: fromTimeField(today, time, record.checks[id]) },
      notes,
    });
  };

  const addUnplanned = () =>
    writeDay({ unplanned: [...(record.unplanned || []), { id: uid(), t: new Date().toISOString() }] });

  const removeUnplanned = (id) =>
    writeDay({ unplanned: (record.unplanned || []).filter((u) => u.id !== id) });

  const editUnplanned = (id, { time, note }) =>
    writeDay({
      unplanned: (record.unplanned || []).map((u) =>
        u.id === id ? { ...u, t: fromTimeField(today, time, u.t), note: note || undefined } : u
      ),
    });

  const checkedCount = slots.filter((s) => record.checks[s.id]).length;
  const unplanned = record.unplanned || [];

  // Place each unplanned mark after however many meals were already checked when it happened.
  const unplannedAt = useMemo(() => {
    const map = {};
    unplanned.forEach((u) => {
      let pos = 0;
      slots.forEach((s) => {
        const t = record.checks[s.id];
        if (t && t <= u.t) pos += 1;
      });
      (map[pos] = map[pos] || []).push(u);
    });
    return map;
  }, [unplanned, slots, record.checks]);

  const history = useMemo(() => {
    const out = [];
    for (let i = 13; i >= 0; i--) {
      const k = shiftDay(today, -i);
      const r = days[k];
      out.push({
        key: k,
        planned: r?.planned ?? settings.slots.length,
        checks: r ? Object.keys(r.checks || {}).length : 0,
        extra: r ? (r.unplanned || []).length : 0,
        isToday: k === today,
      });
    }
    return out;
  }, [days, today, settings.slots.length]);

  const weekExtras = history.slice(7).reduce((a, d) => a + d.extra, 0);

  const dateLabel = useMemo(() => {
    const [y, m, d] = today.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }, [today]);

  // Resolved from the record rather than captured when the row was tapped, so
  // a midnight rollover under an open dialog closes it instead of writing to a
  // day that is no longer on screen.
  const editTarget = useMemo(() => {
    if (!editing) return null;
    if (editing.kind === "slot") {
      const t = record.checks[editing.id];
      return t ? { time: toTimeField(t), note: (record.notes || {})[editing.id] } : null;
    }
    const u = unplanned.find((x) => x.id === editing.id);
    return u ? { time: toTimeField(u.t), note: u.note } : null;
  }, [editing, record, unplanned]);

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
        {/* Header */}
        <header className="flex items-start justify-between gap-4">
          <div>
            <p
              className="text-xs uppercase tracking-widest"
              style={{ color: C.muted, fontFamily: FONT.mono }}
            >
              Today
            </p>
            <h1 className="mt-1 text-3xl leading-tight" style={{ fontFamily: FONT.display }}>
              {dateLabel}
            </h1>
          </div>
          <button
            onClick={() => setPanel(!panel)}
            aria-expanded={panel}
            className="mt-1 shrink-0 rounded-full px-3 py-1.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{
              background: panel ? C.surfaceHi : C.surface,
              color: C.muted,
              fontFamily: FONT.mono,
            }}
          >
            {panel ? "Close" : "Settings"}
          </button>
        </header>

        <p className="mt-3 text-sm" style={{ color: C.muted, fontFamily: FONT.mono }}>
          {checkedCount} of {slots.length} checked
          {unplanned.length > 0 && ` · ${unplanned.length} unplanned`}
        </p>

        {/* Settings */}
        {panel && (
          <section
            className="mt-5 rounded-2xl p-4"
            style={{ background: C.surface }}
          >
            <p className="text-xs uppercase tracking-widest" style={{ color: C.muted, fontFamily: FONT.mono }}>
              Your day
            </p>

            <label className="mt-3 flex items-center justify-between gap-3 text-sm">
              <span>Offer a training-day slot</span>
              <button
                onClick={() => writeSettings({ ...settings, trainingEnabled: !settings.trainingEnabled })}
                role="switch"
                aria-checked={settings.trainingEnabled}
                className="h-6 w-11 shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                style={{ background: settings.trainingEnabled ? C.done : C.surfaceHi }}
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

            <div className="mt-5 flex flex-wrap gap-2 pt-4" style={{ borderTop: `1px solid ${C.rail}` }}>
              <button
                onClick={() => {
                  exportFile({ settings, days });
                  setNotice("Backup downloaded");
                }}
                className="rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                style={{ background: C.surfaceHi, color: C.chalk }}
              >
                Download a backup
              </button>
              <button
                onClick={async () => {
                  try {
                    const parsed = await importFile();
                    const nextSettings = { ...DEFAULTS, ...(parsed.settings || {}) };
                    setSettings(nextSettings);
                    setDays(parsed.days || {});
                    persist(nextSettings, parsed.days || {});
                    setNotice("Backup restored");
                  } catch (e) {
                    setNotice(e.message);
                  }
                }}
                className="rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                style={{ background: C.surfaceHi, color: C.chalk }}
              >
                Restore a backup
              </button>
              <button
                onClick={async () => {
                  if (!confirmClear) return setConfirmClear(true);
                  setDays({});
                  await clear();
                  setConfirmClear(false);
                  setNotice("History erased");
                }}
                onBlur={() => setConfirmClear(false)}
                className="rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                style={{ background: "transparent", color: confirmClear ? C.brass : C.muted }}
              >
                {confirmClear ? "Tap again to erase" : "Erase all history"}
              </button>
            </div>

            {/* An installed copy checks for itself whenever it comes back to
                the foreground; this is for when you want to know right now. */}
            <div
              className="mt-5 flex items-center justify-between gap-3 pt-4"
              style={{ borderTop: `1px solid ${C.rail}` }}
            >
              <span className="text-xs" style={{ color: C.rail, fontFamily: FONT.mono }}>
                Version {BUILD_ID}
              </span>
              <button
                onClick={async () => {
                  setNotice("Checking…");
                  const result = await checkForUpdate({ force: true });
                  if (result === "updating") setNotice("Updating…");
                  else if (result === "unknown") setNotice("Couldn't check — you may be offline");
                  else setNotice("You're on the latest version");
                }}
                className="rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                style={{ background: C.surfaceHi, color: C.chalk }}
              >
                Check for updates
              </button>
            </div>
          </section>
        )}

        {/* The rail */}
        <section className="relative mt-6">
          {settings.trainingEnabled && (
            <button
              onClick={() => {
                const checks = { ...record.checks };
                if (record.training) delete checks["__training"];
                writeDay({ training: !record.training, checks });
              }}
              className="mb-4 rounded-full px-3 py-1.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{
                background: record.training ? C.surfaceHi : "transparent",
                color: record.training ? C.chalk : C.muted,
                border: `1px solid ${record.training ? C.done : C.rail}`,
                fontFamily: FONT.mono,
              }}
            >
              {record.training ? "Training day" : "Mark as a training day"}
            </button>
          )}

          <div className="relative">
            {/* vertical line */}
            <div
              className="absolute left-[19.5px] top-3 bottom-3 w-px"
              style={{ background: C.rail }}
              aria-hidden="true"
            />

            <ul className="flex flex-col gap-1">
              {(unplannedAt[0] || []).map((u) => (
                <UnplannedRow key={u.id} u={u} onEdit={setEditing} />
              ))}
              {slots.map((s, i) => {
                const t = record.checks[s.id];
                const note = (record.notes || {})[s.id];
                return (
                  <li key={s.id}>
                    <button
                      // A checked row opens the editor rather than clearing
                      // itself — undoing a meal shouldn't be one stray tap away.
                      onClick={() =>
                        t ? setEditing({ kind: "slot", id: s.id, label: s.label }) : check(s.id)
                      }
                      aria-pressed={!!t}
                      aria-label={t ? `Edit ${s.label}` : `Check off ${s.label}`}
                      className="row flex w-full items-center gap-4 rounded-xl px-2 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      style={{ background: t ? C.surface : "transparent" }}
                    >
                      <span
                        className="node relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                        style={{
                          background: t ? C.done : C.ground,
                          border: `1px solid ${t ? C.done : C.rail}`,
                          transform: t ? "scale(1)" : "scale(0.82)",
                        }}
                      >
                        {t && (
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
                          <span className="block truncate text-xs" style={{ color: C.muted }}>
                            {note}
                          </span>
                        )}
                      </span>
                      <span className="text-xs" style={{ color: t ? C.done : C.rail, fontFamily: FONT.mono }}>
                        {t ? clock(t) : "—"}
                      </span>
                    </button>

                    {(unplannedAt[i + 1] || []).map((u) => (
                      <UnplannedRow key={u.id} u={u} onEdit={setEditing} />
                    ))}
                  </li>
                );
              })}
            </ul>
          </div>

          <button
            onClick={addUnplanned}
            className="mt-4 ml-1 rounded-full px-4 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{ background: "transparent", color: C.brass, border: `1px dashed ${C.brass}` }}
          >
            Log something unplanned
          </button>
        </section>

        {/* History. mt-auto takes up whatever the rail leaves over, so a short
            day puts the slack above this strip instead of below it. */}
        <section className="mt-auto pt-8">
          <p className="text-xs uppercase tracking-widest" style={{ color: C.muted, fontFamily: FONT.mono }}>
            Last two weeks
          </p>
          <div className="mt-4 flex items-end justify-between gap-1">
            {history.map((d) => (
              <div key={d.key} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex flex-col-reverse gap-[3px]">
                  {Array.from({ length: Math.max(d.planned, 1) }).map((_, i) => (
                    <span
                      key={i}
                      className="block h-[7px] w-[7px] rounded-[2px]"
                      style={{ background: i < d.checks ? C.done : C.rail }}
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
                <span
                  className="text-[10px]"
                  style={{ color: d.isToday ? C.chalk : C.rail, fontFamily: FONT.mono }}
                >
                  {d.key.slice(8)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm" style={{ color: C.muted }}>
            {weekExtras === 0
              ? "Nothing unplanned logged this week."
              : `${weekExtras} unplanned ${weekExtras === 1 ? "snack" : "snacks"} in the last 7 days.`}
          </p>
          <p
            className="mt-4 text-xs"
            style={{ color: saveError ? C.brass : C.rail, fontFamily: FONT.mono }}
            aria-live="polite"
          >
            {saveError
              ? "Couldn't save — this browser is blocking storage."
              : notice
                ? notice
                : saving
                  ? "Saving…"
                  : "Saved on this device"}
          </p>
        </section>
      </div>

      {editing && editTarget && (
        <EditDialog
          key={editing.id}
          title={editing.label}
          time={editTarget.time}
          note={editTarget.note}
          removeLabel={editing.kind === "slot" ? "Uncheck" : "Remove"}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            if (editing.kind === "slot") editCheck(editing.id, patch);
            else editUnplanned(editing.id, patch);
            setEditing(null);
          }}
          onRemove={() => {
            if (editing.kind === "slot") uncheck(editing.id);
            else removeUnplanned(editing.id);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function UnplannedRow({ u, onEdit }) {
  return (
    <button
      onClick={() => onEdit({ kind: "unplanned", id: u.id, label: "Unplanned" })}
      aria-label="Edit this unplanned entry"
      className="row flex w-full items-center gap-4 rounded-xl py-1.5 pl-2 pr-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center">
        <span
          className="block h-[7px] w-[7px] rotate-45"
          style={{ background: C.brass }}
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm" style={{ color: C.brass }}>
          Unplanned
        </span>
        {u.note && (
          <span className="block truncate text-xs" style={{ color: C.muted }}>
            {u.note}
          </span>
        )}
      </span>
      <span className="text-xs" style={{ color: C.brass, fontFamily: FONT.mono }}>
        {clock(u.t)}
      </span>
    </button>
  );
}

// One editor for both kinds of entry. It holds a draft so a half-typed note or
// a momentarily empty time field never reaches the record, and so Cancel is a
// real cancel.
function EditDialog({ title, time, note, removeLabel, onSave, onRemove, onClose }) {
  const [draftTime, setDraftTime] = useState(time);
  const [draftNote, setDraftNote] = useState(note || "");

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const field =
    "mt-1 w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white";
  const fieldStyle = { background: C.surfaceHi, color: C.chalk, border: "none" };

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
        aria-label={`Edit ${title}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl p-5"
        style={{
          background: C.surface,
          color: C.chalk,
          fontFamily: FONT.body,
        }}
      >
        <p className="text-xs uppercase tracking-widest" style={{ color: C.muted, fontFamily: FONT.mono }}>
          Editing
        </p>
        <h2 className="mt-1 text-2xl leading-tight" style={{ fontFamily: FONT.display }}>
          {title}
        </h2>

        <label className="mt-4 block text-sm" style={{ color: C.muted }}>
          Time
          <input
            type="time"
            value={draftTime}
            onChange={(e) => setDraftTime(e.target.value)}
            className={`${field} block min-w-0 max-w-full`}
            style={{ ...fieldStyle, boxSizing: "border-box" }}
          />
        </label>

        <label className="mt-4 block text-sm" style={{ color: C.muted }}>
          Notes
          <textarea
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
            className="rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{ background: "transparent", color: C.brass }}
          >
            {removeLabel}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ background: "transparent", color: C.muted }}
            >
              Cancel
            </button>
            <button
              onClick={() => onSave({ time: draftTime, note: draftNote.trim() })}
              disabled={!draftTime}
              className="rounded-lg px-4 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
              style={{ background: C.done, color: C.ground }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
