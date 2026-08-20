export const C = {
  ground: "#10262B",
  surface: "#163339",
  surfaceHi: "#1D4048",
  // `surface` carried over to the brass family: the same weight of fill for a
  // row, warm instead of teal, so an unplanned snack reads as a peer of the
  // meals above it and still says at a glance that it isn't one.
  surfaceBrass: "#372F24",
  rail: "#2C545C",
  chalk: "#E9EFEA",
  muted: "#89AAA8",
  // The quietest a *word* is allowed to get. `rail` is 1.9:1 on ground — right
  // for a hairline, unreadable as text — and `muted` at 6.3:1 is louder than a
  // version number wants to be. This sits between them at 5.2:1 on ground and
  // 4.5:1 on surface, so a line can recede without going under the WCAG floor.
  faintText: "#829A9F",
  // A mark that isn't filled still says something — an unchecked meal, a day
  // with nothing on it — so it clears 3:1 (1.4.11) where `rail` doesn't: 3.5:1
  // on ground, 3.0:1 on surface. Still quiet, just no longer a rumour.
  faint: "#5E7D83",
  done: "#9CC5A1",
  brass: "#D8A657",
  red: "#EA6962",
  gold: "#F2C55C",
  goldGlow: "rgba(242,197,92,0.6)",
  silver: "#A2ADB0",
  // The worst grade, in two weights, because one colour can't do both jobs on a
  // page this dark. `redDeep` is a *fill* with chalk on top of it — 7.1:1 for
  // the numeral, which is what the calendar needs — but at 1.9:1 against the
  // page it can't be seen on its own. `redDeepEdge` is the same red carried up
  // to 3.5:1 for the marks that stand alone with nothing written on them: the
  // broken ring, and the ring that lifts a terrible day off the calendar.
  // Anything at 3:1 on this ground is too light to put 14px text on — the
  // ceiling there is 4.3:1 even in pure white — so the split isn't avoidable.
  redDeep: "#7E3A36",
  redDeepEdge: "#9D6A67",
  sheen: "rgba(255,255,255,0.4)",
  scrim: "rgba(8,20,23,0.72)",
  // The weekend backdrop on the two-week strip: a wash low-contrast enough to
  // read as a zone rather than a grade, plus the seam that keeps Saturday and
  // Sunday legible as two days inside the one container.
  weekendWash: "rgba(216,166,87,0.09)",
  weekendEdge: "rgba(216,166,87,0.16)",
  weekendSeam: "rgba(216,166,87,0.3)",
};

export const FONT = {
  display:
    '"Iowan Old Style","Palatino Linotype",Palatino,Georgia,ui-serif,serif',
  body: 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif',
  mono: "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
};
