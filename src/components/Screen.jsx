import { C, FONT } from "../theme.js";

export function Screen({ children, overlay }) {
  return (
    <div
      className="flex w-full flex-col px-5 sm:px-8"
      style={{
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

export function StatusLine({ saveError, notice, saving }) {
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
