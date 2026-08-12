# AGENTS.md

Meal Rail — a client-only PWA meal checklist. React 19 + Vite 8 + Tailwind 4, no
backend, no accounts, no tests. State lives in `localStorage`.

## Commands

```bash
npm install
npm run dev      # vite dev server
npm run build    # production build to dist/
npm run preview  # serve the built output
npm test         # run domain tests with Node's built-in test runner
npm run lint     # JavaScript/JSX and theme-color checks
npm run format:check # verify formatting
```

Node 26 (`.nvmrc`). There is no typecheck step — run tests, lint, and formatting
checks, then verify behavioral changes by running the app.

## Previewing a dev build

A fresh server is a fresh browser profile: `localStorage` is empty, so the app
opens on an unchecked day with an empty strip, an empty calendar and no grades —
which is most of what there is to look at. Seed it.

**Hand the user JSON to paste, in the chat.** One fenced block they copy, then
Settings → Your data → **Paste text** → Restore. Do not write a `.json` file to
`/tmp` or into the repo and ask them to Load a file: that is a download dialog, a
file picker and a stray file to clean up, and it doesn't work at all when the
thing they are previewing on is a phone pointed at the LAN URL, where a path on
your machine means nothing. A paste crosses that gap; it is what the clipboard
pair exists for (see Backups).

What the seed has to get right:

- The whole blob, `{ settings, days }`. `parseBackup` rejects anything without a
  `days` key, and a restore replaces `settings` too — omitting it silently resets
  the slots to `DEFAULTS`.
- Dates inside the last two weeks, computed from **today's** date, not last
  month's. Keys are local `YYYY-MM-DD`; a day outside the window is invisible in
  the strip, and one past `RETENTION_DAYS` is trimmed on the first save.
- `planned` on every day, and whatever shapes the change actually touches —
  `notes`, `unplanned`, `workouts`, `drinks`. Cover the grades you want looked at
  (gold, green, silver, bad, terrible) rather than fourteen identical days.

Say in the same message that Restore replaces everything currently logged, and
that **Copy as text** takes a backup first. On a machine the user checks real days
on, that warning is the difference between a preview and a data loss.

Driving the app yourself — devtools, a headless browser — is different: write the
key straight in with `localStorage.setItem("mealrail:v1", …)` and reload. It is
fewer moving parts than typing into a dialog, and it exercises `load()`'s
migration rather than `parseBackup`'s. If you do drive the paste dialog, note that
the textarea is controlled: an automation tool that assigns `.value` without
dispatching an `input` event leaves React holding the previous text, and Restore
will parse _that_ — the field looks right and the error makes no sense.

## Layout

```
src/main.jsx      entry point; starts the service worker and the update check
src/App.jsx       the UI — one component plus DayRail and the row/dialog parts
src/grade.js      pure grading and day-record domain helpers
src/day.js        pure local-date and retention helpers
src/storage.js    persistence; the only file that touches a storage API
src/theme.js      color and font constants
src/haptics.js    the buzz under the finger, delegated from one listener
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
- **Anything in `index.css` that styles an element by tag belongs in
  `@layer base`.** Unlayered CSS outranks layered CSS whatever the specificity,
  and Tailwind's utilities are layered — an unlayered `button { font: inherit }`
  once beat every `text-*` class in the app, silently, for months. Tailwind's
  preflight already normalises form elements; you rarely need such a rule at all.

## Haptics

`src/haptics.js` buzzes the phone when a control fires. One capture-phase `click`
listener on `document`, started from `main.jsx` — not a call inside each of the
app's ~50 handlers, which is a line every new control would have to remember.
Nothing needs adding for a button to feel like the rest of the app.

Two weights. Everything gets `tap`; a control that _writes an entry in one press_
— checking a meal off, the three `AddButton`s, Save in the past-day editor — opts
up to the firmer `commit` with `data-haptic="commit"`. Opening the editor on a
meal already checked is a `tap`, so the attribute on the rail row is conditional.
Don't spread `commit` any further: it means something landed only while it is
rarer than the other one.

It listens for `click` rather than `pointerdown` because a finger landing on the
two-week strip to scroll it would otherwise buzz for a gesture that activated
nothing, and in capture so a handler calling `stopPropagation` — the dialog's
inner panel does — can't silence it. Native `disabled` never dispatches a click;
`aria-disabled` is checked by hand.

Assume it does nothing. Safari has never shipped `navigator.vibrate`, so on an
iPhone this is very likely inert, and a phone in silent mode or with system
haptics off ignores the call everywhere. The module no-ops when the API is
missing and nothing in the app may depend on a buzz having happened. There is no
in-app toggle on purpose — the OS already owns that switch.

## Data model

One JSON blob under the `mealrail:v1` key:

```js
{
  settings: {
    slots: [{ id, label }], trainingEnabled, promptNotes,
    stripMark, stripGrade,        // how the two-week strip draws a day
  },
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
circle _started_, so the first drink already counts and the third opens a second
circle. No negatives and every planned slot checked is `gold`, no negatives and
some checked is `green`, one negative is `silver`, two is `bad`, three or more
is `terrible`. A day with nothing checked caps at `empty` unless its negatives
alone earned worse, and a day with no entries at all gets nothing. Grades are
derived at render time — nothing about them is persisted, so old backups load
unchanged.

How the strip _draws_ that is the one thing in the app with a preferences
screen. `stripMark` picks between four marks — `boxes` (the original, and the
default), `capsule`, `capsuleFull`, `track` — and `stripGrade` picks between
`badge` (the default), `tint` and `none`. They are independent: any mark wears
any grade, which is why `StripDay` draws the mark from a lookup and the grade
and date itself. Settings → Two-week strip has both, over a preview of
`SAMPLE_FORTNIGHT` docked at the foot of the screen, where the real strip sits.

Two flat keys rather than one nested object, because `load` and
`restoreBackup` merge settings **shallowly** — a backup written before a third
key existed would replace the whole object and silently drop it. For the same
reason both are validated against the option lists on the way out of `settings`
rather than trusted: they can arrive from a hand-edited backup, and an unknown
value falls back to the default instead of rendering nothing.

`none` draws no grade at all, and that is allowed. The column's `aria-label`
states it either way, so the setting changes how the strip looks and not what it
says. `tint` can't use `redDeepEdge` or `faint` — both 3.5:1, under the 4.5:1
floor a numeral has to clear — so `terrible` is `red` with a rule under it and
`empty` is the date's own `faintText`. Don't "fix" those two back to the badge's
colours; see `STRIP_TINT`. None of this reaches the calendar, which has its own
constraint: a numeral sits _inside_ the disc there, so every tier is a flat fill.

The preview's fourteen days are made up and say so on screen. They live in
`grade.js` as `SAMPLE_FORTNIGHT` and take their badges from `dayBadge`, so the
preview can't lie about the rules, and a test asserts every tier appears — a
real fortnight shows whichever grades it happened to earn, which is none of the
ones you are choosing between if the fortnight went well.

Every strip column but today's is a button opening that day, the same route a
calendar cell takes. Today's is a plain element rather than a disabled button —
`openPastDay` refuses `key >= today`, and the rail above is already showing it.
Fourteen columns share the width of a phone, so the spacing between them is
padding _inside_ each column rather than a `gap` on the row: it looks identical
and the touch zones tile instead of leaving a third of the strip dead.

The calendar only looks backwards. `shiftMonth` clamps to the month `today`
falls in, the forward chevron is `disabled` there rather than removed — taking
it away would re-centre the month label every time you reached the present — and
a "Today" button appears in the header the moment you leave that month, so six
months back is one tap from home rather than six. The ceiling comes from `today`
state, not a fresh `new Date()`, for the same reason `daySummary` takes it as an
argument: a midnight rollover under an open calendar has to move both together.

A past day opened from the calendar can be corrected or backfilled, and it does
that against a **draft** rather than writing through the way today does. Today is
the day you are living: a tap is the record, and it lands in `localStorage`
immediately. A past day is a reconstruction, so nothing reaches storage until
Save, leaving with unsaved work asks first, and a draft that ends up empty
deletes the day's key instead of writing a hollow record — `isEmptyDay` in
`App.jsx`. Edit mode is its own `history` entry (`{ view: "day", day, edit: true }`)
so the device's back button leaves it the way the in-app Cancel does; `editRef`
mirrors the draft synchronously because the `popstate` listener is mounted once
and can't close over state. A dirty pop is undone by pushing the entry straight
back and asking instead.

Both screens drive one `DayRail` and one pair of dialogs through `activeKey` /
`activeRecord`, so every entry control has exactly one implementation. Two things
differ by day:

- **Timestamps.** A backfilled entry has no clock to read, so it lands at
  `BACKFILL_TIMES[slot index]` (or `BACKFILL_SNACK` / `BACKFILL_WORKOUT`) on that
  date via `stampOn`, and the editor opens on top of it — a made-up time you
  confirm rather than one written behind your back. Cancelling that dialog leaves
  the entry at its default; Uncheck and Remove sit in the same dialog. Today
  stamps the live clock and opens nothing.
- **`planned`.** Today is measured against the current plan. A past day keeps the
  count it was written with (`plannedBase` backs the workouts out and adds them
  again), so correcting a day can never rewrite what it was graded against.

Days past `RETENTION_DAYS` can be read but not edited: `persist` trims them on
every save, so the correction would be thrown away the moment it was written.
That is why the Edit button is replaced by a line saying so rather than merely
disabled.

`settings.slots` has no UI. It is edited by hand or by restoring a backup — the
app is a checklist, and re-cutting the slots mid-history makes the two-week
strip lie about days that were planned differently. A past day's checks against
slot ids that no longer exist are invisible in both the read-only view and the
editor, which both render `slots.map(...)`; the fix is dated plans, not a
special case here.

## Backups

`localStorage` is the only copy of anything, so settings carries four ways to
move it: a file or the clipboard, out or in. They sit in a 2×2 grid under "Your
data" — a column per direction, a row per medium — because each one's opposite
number belongs next to it, and the erase button stays at the foot of the screen
so it is never a stray tap away from them.

All four carry the same JSON, and both ways in go through `parseBackup` in
`storage.js`: one place that validates and one place that runs `migrate`. Split
that and a backup that loads from a file will one day fail to load from a paste.
Its messages are written to be shown verbatim, which is why they say "that"
rather than "that file". Both ways in also land on `restoreBackup` in `App.jsx`,
so a file and a paste can't drift into meaning two different things.

The clipboard is for a phone with nowhere good to put a file: paste a backup into
a message to yourself and read it back on the other device. Coming back in it is
text the user pastes into a field rather than a `clipboard.readText()` — that is
a permission prompt on some platforms and unavailable on others, and the field
means an unreadable backup can be fixed where it stands. It is also the one
failure reported inside a dialog rather than on the status line, for the same
reason: closing the dialog to complain would throw away what was pasted.
`exportClipboard` keeps a selection-based fallback because `navigator.clipboard`
is undefined outside a secure context, which is exactly what a build served over
the LAN to a phone is.

## Deploying

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and
publishes to GitHub Pages. The workflow passes `BASE_PATH=/<repo-name>/` because
project Pages sites are served from a subpath; `vite.config.js` reads it. Never
hardcode a base path.

## Pull requests

When a change has an associated GitHub issue, link the pull request by including
`Closes #<issue-number>` in its description. This makes the connection visible
and closes the issue automatically when the pull request merges.

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
