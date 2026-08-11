// A short buzz under the finger when a control is activated.
//
// The Vibration API is the only haptic a web app gets, and it is not everywhere:
// Safari has never shipped `navigator.vibrate` as a documented feature, so on an
// iPhone this file is very likely doing nothing at all. That is the deal — it
// costs one feature check, it is silent where it isn't supported, and Android
// gets the feedback. Nothing in the app may depend on a buzz having happened.
//
// The phone's own switches sit above this: a device in silent mode, or with
// system haptics off, ignores the call. There is deliberately no in-app toggle
// duplicating that.

// Milliseconds. Long enough to feel on a phone motor, short enough that a run of
// taps doesn't turn into a rattle. `commit` is for the taps that write something
// down — a meal checked, a snack, a drink — so logging feels heavier than
// navigating, which is the only distinction worth making by touch alone.
const PATTERNS = {
  tap: 10,
  commit: 22,
};

const supported =
  typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

export function haptic(kind = "tap") {
  if (!supported) return;
  try {
    navigator.vibrate(PATTERNS[kind] ?? PATTERNS.tap);
  } catch {
    // Some engines throw rather than no-op when vibration is disallowed.
  }
}

// One delegated listener rather than a call in each of the app's ~50 handlers:
// every control gets the same feel by default, and none can be forgotten. A
// button that logs something opts up to `commit` with `data-haptic="commit"`.
//
// It listens for `click`, not `pointerdown`. Pressing down fires the moment a
// finger lands, including the finger that is starting a scroll over the
// two-week strip — a buzz for a gesture that activated nothing. `click` only
// arrives when the control actually fires, which is what the buzz is reporting.
// Capture phase so a handler calling `stopPropagation` can't silence it.
export function watchTaps() {
  if (!supported) return;
  document.addEventListener(
    "click",
    (e) => {
      const el = e.target?.closest?.(
        "button, [role='button'], a[href], summary",
      );
      // `disabled` never dispatches click; `aria-disabled` renders as live and
      // has to be checked by hand.
      if (!el || el.getAttribute("aria-disabled") === "true") return;
      haptic(el.dataset.haptic);
    },
    true,
  );
}
