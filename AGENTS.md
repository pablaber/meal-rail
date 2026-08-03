# AGENTS.md

Meal Rail — a client-only PWA meal checklist. React 18 + Vite 6 + Tailwind 4, no
backend, no accounts, no tests. State lives in `localStorage`.

## Commands

```bash
npm install
npm run dev      # vite dev server
npm run build    # production build to dist/
npm run preview  # serve the built output
```

Node 26 (`.nvmrc`). There is no lint, test, or typecheck step — verify changes by
running the app.

## Layout

```
src/main.jsx      entry point; starts the service worker and the update check
src/App.jsx       the entire UI — one component plus UnplannedRow
src/storage.js    persistence; the only file that touches a storage API
src/theme.js      color and font constants
src/update.js     build id, service worker registration, update check
public/sw.js      offline cache
index.html        PWA meta tags
```

## Conventions

- **Colors and fonts come from `theme.js` as inline styles.** Tailwind is used for
  layout and spacing only. Do not add colors as Tailwind classes or hardcode hex
  values in components.
- **All persistence goes through `storage.js`.** `load()` / `save()` are async on
  purpose so a real backend can be swapped in without touching `App.jsx`.
- Plain JavaScript with JSX — no TypeScript.
- Two-space indent, double-quoted strings, semicolons (see `.editorconfig`).
- Interactive elements need a visible focus ring
  (`focus:outline-none focus-visible:ring-2 focus-visible:ring-white`) and an
  `aria-*` attribute where the label isn't self-evident.

## Data model

One JSON blob under the `mealrail:v1` key:

```js
{
  settings: { slots: [{ id, label }], trainingEnabled },
  days: {
    "YYYY-MM-DD": {
      checks: { [slotId]: isoTimestamp },
      notes: { [slotId]: string },   // optional, absent on days with no notes
      unplanned: [{ id, t, note }],  // note optional
      workouts: [{ id, t, note }],   // optional, absent on days with no workouts
      drinks: number,                // optional, absent on days with no drinks
      planned,
    },
  },
}
```

Days older than 400 are trimmed on every save. Changing this shape breaks existing
users' data and their backup files — migrate in `storage.js`, don't bump the key
casually. Notes sit in a map beside `checks` rather than turning each check into
an object, so a backup taken before notes existed still loads unchanged; read
them as `(record.notes || {})[id]`. `drinks` is the same deal — read it as
`record.drinks || 0`, and write `undefined` rather than `0` so the key drops out
of days where nothing was logged.

A workout snack is logged already checked, so it lands in `workouts` and lifts
both `planned` and the day's check count by one. It can never cost the day a
grade and can never cover for a meal that went unchecked — the strip just grows
one more filled box. Everything else the day picks up off-plan (`unplanned`,
`drinks`) is a negative; this is the one that isn't, which is why it draws as a
meal row rather than a mark beside one.

One a day. `workouts` stays an array because the rail, the migration, and the
grade all read it as one, but `addWorkout` refuses a second and the button dims
to a tick once the day has had its one. Removing it drops the key entirely, the
way `drinks` does — which is why `writeDay` tests `"workouts" in patch` rather
than falling back with `??`, or the day would keep planning a slot that no
longer exists.

`training: true` — the old flag that appended a self-checked slot — no longer
exists. `migrateDay` in `storage.js` rewrites it on the way in, for both `load()`
and a restored backup: a checked training day becomes a workout at the same time
and keeps the day's grade exactly; an unchecked one becomes nothing and gives its
slot back to `planned`, which can move that day green → gold. That is deliberate
— the new model has no way to say "meant to work out and didn't". Don't drop the
migration; backups predating it are still out there.

`DRINKS_PER_CIRCLE` in `App.jsx` is 2: each drink fills half a red circle, so a
full circle is exactly Canada's per-day ceiling and one drink sits visibly half
way there. Change that one number to re-cut the scale — `drinkCircles`, the
badge tiers below, and every surface all read from it. `DRINK_DOTS_MAX` and
`STRIP_DRINK_DOTS` beside it cap how many circles each surface draws; past the
cap the count beside them is the honest number. The circles are drawn by
`DrinkDot`, shared by the day view badge and the two-week strip.

Every day in the two-week strip but today is graded by `dayBadge` and drawn by
`DayBadge`. An unplanned entry is one negative; drinks are one negative per
circle *started*, so the first drink already counts and the third opens a second
circle. No negatives and every planned slot checked is `gold`, no negatives and
some checked is `green`, one negative is `silver`, two is `bad`, three or more
is `terrible`. A day with nothing checked caps at `empty` unless its negatives
alone earned worse, and a day with no entries at all gets nothing. Grades are
derived at render time — nothing about them is persisted, so old backups load
unchanged.

`settings.slots` has no UI. It is edited by hand or by restoring a backup — the
app is a checklist, and re-cutting the slots mid-history makes the two-week
strip lie about days that were planned differently.

## Deploying

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and
publishes to GitHub Pages. The workflow passes `BASE_PATH=/<repo-name>/` because
project Pages sites are served from a subpath; `vite.config.js` reads it. Never
hardcode a base path.

## Updates

An installed PWA can outlive many releases — iOS resumes a home-screen app
rather than reloading it, so nothing ever fetches the new build. Three pieces
handle that, and they only work together:

- `vite.config.js` stamps each build with an id (the commit on CI) — inlined as
  `__BUILD_ID__` and written to `dist/version.json`.
- `src/update.js` fetches `version.json` on load and whenever the app returns to
  the foreground. A different id means drop the caches and reload. A
  session-scoped guard in `storage.js` stops a stale CDN edge causing a loop.
- `public/sw.js` is registered as `sw.js?v=<build id>`. The file itself never
  changes, so the query string is what makes the browser install a new worker.

So don't cache `version.json`, don't drop the query string from the
registration, and don't give navigations anything but a network-first,
`no-store` fetch — `index.html` names the fingerprinted bundles, and a stale
copy pins the app to an old build.

The cache name is deliberately not versioned: a per-build cache would sit empty
for the session following an update, which is when offline is most likely to be
needed. It is bounded by `MAX_ENTRIES` instead, and the update reload clears it.
