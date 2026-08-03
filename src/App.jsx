import { useState, useEffect, useMemo, useCallback } from "react";
import { C, FONT } from "./theme.js";
import { load, save, clear, exportFile, importFile } from "./storage.js";

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

  const record = days[today] || { checks: {}, unplanned: [], training: false };

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

  const toggle = (id) => {
    const checks = { ...record.checks };
    if (checks[id]) delete checks[id];
    else checks[id] = new Date().toISOString();
    writeDay({ checks });
  };

  const addUnplanned = () =>
    writeDay({ unplanned: [...(record.unplanned || []), { id: uid(), t: new Date().toISOString() }] });

  const removeUnplanned = (id) =>
    writeDay({ unplanned: (record.unplanned || []).filter((u) => u.id !== id) });

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
      className="min-h-screen w-full px-5 py-8 sm:px-8"
      style={{ background: C.ground, color: C.chalk, fontFamily: FONT.body }}
    >
      <style>{`
        .node, .seg, .row { transition: all 220ms cubic-bezier(.2,.7,.3,1); }
        @media (prefers-reduced-motion: reduce) {
          .node, .seg, .row { transition: none !important; }
        }
      `}</style>

      <div className="mx-auto w-full max-w-md">
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
            {panel ? "Close" : "Edit"}
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
            <div className="mt-3 flex flex-col gap-2">
              {settings.slots.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2">
                  <input
                    value={s.label}
                    onChange={(e) => {
                      const slotsNext = settings.slots.map((x) =>
                        x.id === s.id ? { ...x, label: e.target.value } : x
                      );
                      writeSettings({ ...settings, slots: slotsNext });
                    }}
                    className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    style={{ background: C.surfaceHi, color: C.chalk, border: "none" }}
                  />
                  <button
                    onClick={() => {
                      const slotsNext = settings.slots.filter((x) => x.id !== s.id);
                      writeSettings({ ...settings, slots: slotsNext });
                    }}
                    disabled={settings.slots.length <= 1}
                    aria-label={`Remove ${s.label}`}
                    className="rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-30"
                    style={{ background: C.surfaceHi, color: C.muted }}
                  >
                    ×
                  </button>
                  <span className="w-4 text-right text-xs" style={{ color: C.rail, fontFamily: FONT.mono }}>
                    {i + 1}
                  </span>
                </div>
              ))}
            </div>

            <button
              onClick={() =>
                writeSettings({
                  ...settings,
                  slots: [...settings.slots, { id: uid(), label: "Snack" }],
                })
              }
              className="mt-3 w-full rounded-lg py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ background: C.surfaceHi, color: C.chalk }}
            >
              Add a slot
            </button>

            <label className="mt-4 flex items-center justify-between gap-3 text-sm">
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
          </section>
        )}

        {/* The rail */}
        <section className="relative mt-8">
          {settings.trainingEnabled && (
            <button
              onClick={() => {
                const checks = { ...record.checks };
                if (record.training) delete checks["__training"];
                writeDay({ training: !record.training, checks });
              }}
              className="mb-5 rounded-full px-3 py-1.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
              className="absolute left-[11px] top-3 bottom-3 w-px"
              style={{ background: C.rail }}
              aria-hidden="true"
            />

            <ul className="flex flex-col gap-1">
              {(unplannedAt[0] || []).map((u) => (
                <UnplannedRow key={u.id} u={u} onRemove={removeUnplanned} />
              ))}
              {slots.map((s, i) => {
                const t = record.checks[s.id];
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => toggle(s.id)}
                      aria-pressed={!!t}
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
                      <span
                        className="flex-1 text-lg"
                        style={{
                          fontFamily: FONT.display,
                          color: t ? C.chalk : C.muted,
                        }}
                      >
                        {s.label}
                      </span>
                      <span className="text-xs" style={{ color: t ? C.done : C.rail, fontFamily: FONT.mono }}>
                        {t ? clock(t) : "—"}
                      </span>
                    </button>

                    {(unplannedAt[i + 1] || []).map((u) => (
                      <UnplannedRow key={u.id} u={u} onRemove={removeUnplanned} />
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

        {/* History */}
        <section className="mt-10">
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
            className="mt-6 text-xs"
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
    </div>
  );
}

function UnplannedRow({ u, onRemove }) {
  return (
    <div className="flex items-center gap-4 py-1.5 pl-2">
      <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center">
        <span
          className="block h-[7px] w-[7px] rotate-45"
          style={{ background: C.brass }}
          aria-hidden="true"
        />
      </span>
      <span className="flex-1 text-sm" style={{ color: C.brass }}>
        Unplanned
      </span>
      <span className="text-xs" style={{ color: C.brass, fontFamily: FONT.mono }}>
        {clock(u.t)}
      </span>
      <button
        onClick={() => onRemove(u.id)}
        aria-label="Remove this entry"
        className="rounded px-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        style={{ color: C.rail }}
      >
        ×
      </button>
    </div>
  );
}
