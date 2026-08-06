# TODO

<!-- Remove completed items from these lists as part of the work effort. -->

<!-- File:line references and measured numbers below were verified against
     41cab6b (2026-08-06). They are load-bearing — if the code has moved, re-check
     rather than trusting them blind. Items marked "Verified" were confirmed by
     reading the code, not inferred. -->

## Confirmed bugs

These are known-broken and reproducible, as distinct from the improvements below.

- [ ] **A dirty past-day draft is lost silently on tab close or app swipe-away.**
  In-app Cancel, the device back button, and Escape all ask first, but there is
  no `beforeunload` handler anywhere in `src/`. `editRef.current.dirty`
  (`App.jsx:267`) already holds exactly the bit needed — it is mirrored
  synchronously for the `popstate` guard and is equally usable here. Verified.
- [ ] **Reloading mid-edit leaves a dead back press.** `view` and `selectedDay`
  are seeded from `window.history.state` on mount (`App.jsx:251-255`) but `draft`
  is not, so a reload during an edit lands on the read-only past day while the
  `{ view: "day", day, edit: true }` entry is still the current history entry.
  The first Back pops to `{ view: "day", day }` and renders the same screen.
  Either re-enter the editor on mount when `state.edit` is set, or replace the
  entry. Verified.
- [ ] **`importFile` never settles if the file picker is cancelled**
  (`storage.js:114-135`) — only `onchange` is wired, and cancelling fires
  `cancel`, not `change`. Harmless today because no UI state is left pending, but
  it is a dangling promise per cancelled restore. Verified.

## Priority: data safety and correctness

- [ ] Make backup restoration safer:
  - Validate the complete backup schema before accepting it. Today `importFile`
    checks only that the parse succeeded and `parsed.days` is truthy
    (`storage.js:124-126`).
  - Preview the backup's date range and entry count.
  - Confirm before replacing current data.
  - Do not report success until the restored data has been saved successfully.
    `persist(...)` is not awaited before `setNotice("Backup restored")`
    (`App.jsx:770-771`). Note this is partly mitigated: `StatusLine` ranks
    `saveError` above `notice`, so a failed write does surface — but as a generic
    storage error rather than "the restore did not land".
  - Consider supporting both replace and merge operations.
- [ ] Handle a failed history deletion instead of reporting "History erased" when
  storage removal did not succeed. `clear()` returns a boolean that is awaited and
  then discarded (`App.jsx:701-706`); `storage.js:70-77` returns `false` on
  failure. Verified.
- [ ] Distinguish corrupt stored data from a new installation and offer a recovery
  warning instead of silently opening an empty app. `load()` returns `null` both
  for an absent key and for a `JSON.parse` throw (`storage.js:50-57`) — one signal
  for two very different situations. Verified.

## Legibility and contrast

Measured with the WCAG relative-luminance formula against `C.ground` (`#10262B`).
The quietness of the palette is clearly deliberate, so the goal is to keep it
while clearing the floor — not to brighten everything.

- [ ] **`C.rail` (`#2C545C`) is 1.90:1 and is used as body text in three places.**
  Fix these: the version line (`App.jsx:796`), the two-week strip's day numbers
  (`:1040`), and `StatusLine` (`:1816`). Suggested addition to `theme.js`:
  `faintText: "#829A9F"` — 5.29:1 on ground, 4.50:1 on `surface`.
- [ ] **Do not blanket-replace `C.rail`.** Most of its other uses are hairlines
  and unfilled tracks where 1.9:1 is correct and the design depends on it:
  section rules (`:749`, `:794`), the vertical rail line (`:1097`), the `DrinkDot`
  unfilled track (`:2008`), and the em dashes standing in for absent times
  (`:1162`, `:1567`). The `AddButton` `done` tone (`:1269`) is on a `disabled`
  control and is WCAG-exempt.
- [ ] **The worst grade is the least visible mark in the app.** `C.redDeep`
  (`#7E3A36`) is 1.91:1, and it draws the `terrible` badge's broken ring
  (`App.jsx:1936`). Suggested: `redDeep: "#9D6A67"` — 3.53:1 on ground, 3.00:1 on
  surface, clearing WCAG 1.4.11 for a meaningful non-text graphic.
- [ ] **On the calendar, `empty` and `terrible` are effectively the same disc.**
  `CALENDAR_TIER.empty` fills with `C.rail` and `.terrible` with `C.redDeep`
  (`App.jsx:119-120`); their contrast *against each other* is **1.01:1**. They
  differ only in hue, both at ~1.9:1 against the page, and both carry `C.chalk`
  numerals. "No meals logged" and "terrible day" are the two most opposite
  verdicts in the app and the two hardest cells to tell apart. This is the same
  finding as "grades should not depend on colour alone" below, arrived at from
  the measurement side — fixing `redDeep` addresses both.
- [ ] Consider whether the unfilled *state* marks want 3:1 too, since they carry
  information rather than decorating: the strip's unchecked meal boxes
  (`:1010`), the unchecked rail node border (`:1126`), and the `empty` badge
  border (`:1953`). `C.faint: "#5E7D83"` (3.54:1 / 3.01:1) is the sibling for
  this tier if so. Lower priority than the text fixes — judgement call, and the
  quiet look may be worth more here.

## Priority: core experience

- [ ] Add a temporary Undo action after checking a meal or adding a snack,
  workout, or drink.
- [ ] Add a compact grade legend to the calendar and two-week history.
- [ ] Give calendar grades a visual treatment that does not depend on color alone.
  See the measured `empty`/`terrible` collision above — that is the concrete case
  this item is protecting against. Note the strip's `DayBadge` already solves this
  with shape (lit disc → plain disc → ring → broken ring); the calendar cannot
  reuse that, because a solid disc is what makes the numeral legible, so this one
  probably has to be won on contrast and hue rather than form.
- [ ] **Add a "jump to today" control to the calendar.** `shiftMonth` is unbounded
  (`App.jsx:555-559`), so browsing six months back leaves six taps as the only way
  home.
- [ ] Consider replacing judgmental grade names such as "Bad" and "Terrible" with
  neutral descriptions such as "On plan", "Partial", or "Off-plan x2".
  `BADGE_LABEL` (`App.jsx:96-103`) is the single source for these; they are read
  by the strip badge, the calendar `aria-label`, and `GradeCard`.
- [ ] Improve snack note capture: either open an optional note field when a snack
  is added or briefly offer an "Add details" action after one-tap logging. Note
  the past-day path already does something close to this — `backfilling`
  (`App.jsx:424-427`) opens the editor straight after adding — so the pattern
  exists and is only withheld from today.

## History and insights

- [ ] Add 7-day and 30-day meal-completion summaries.
- [ ] Show meal, snack, drink, and workout trends separately.
- [ ] Add weekday-versus-weekend comparisons.
- [ ] Explain the 400-day retention window and prevent the calendar from implying
  that older, trimmed dates simply had no activity. Trimmed days render as
  `empty`, which is indistinguishable from a day that genuinely had nothing on it.
  `PastDay` already has the right wording for the read-only case
  (`App.jsx:1365-1370`) — the calendar needs its own version.

## Data portability and onboarding

- [ ] Explain inside the app that data is stored only on the current device.
- [ ] Record and display the date of the most recent backup.
- [ ] Support the system Share sheet for sending backups to Files, AirDrop, or a
  cloud-storage app. This likely replaces the `exportFile` anchor-click path
  (`storage.js:104-112`) on iOS entirely.
- [ ] Consider optional cross-device sync while keeping accounts unnecessary for
  people who only want local storage. `storage.js` is the seam and `load()` /
  `save()` are already async for exactly this — see AGENTS.md.

## Larger optional features

- [ ] Explore optional meal-time reminders configurable per slot, including the
  architectural impact of delivering reliable notifications.
- [ ] **Dated plans — the change that unlocks the most.** `settings.slots` has no
  UI at all, so the app ships Breakfast/Lunch/Dinner and cannot be changed without
  hand-editing JSON. That is the single biggest usability cliff for anyone whose
  day is not those three. AGENTS.md already names the correct design ("the fix is
  dated plans, not a special case here"), and it is more contained than it sounds:

  ```js
  settings.plans: [{ from: "YYYY-MM-DD", slots: [...] }]  // latest `from` <= day
  ```

  Grading is unaffected, because each day already stores its own `planned` and
  `plannedBase` (`App.jsx:232-233`) keeps a past day measured against the count it
  was written with. The work is a `slotsFor(key)` helper, a settings screen, and
  pointing the two `slots.map(...)` call sites at it. Doing this also retires the
  standing caveat that checks against retired slot ids are invisible in both the
  read-only view and the editor.

## Accessibility

- [ ] Add initial focus, focus trapping, and focus restoration to dialogs.
  **Escape handling already exists** — `Dialog` (`App.jsx:2022-2028`) listens for
  it, and backdrop-tap-to-close is wired at `:2032`. The screen-level Escape
  handler (`:349-359`) deliberately defers to an open dialog. So the remaining gap
  is narrower than this item originally implied: focus never enters the dialog, is
  not trapped, and is not returned to the trigger on close. Verified.
- [ ] **Give the workout switch an explicit accessible name.** The `<label>` at
  `App.jsx:730` wraps both the text `<span>` and the `<button role="switch">`
  (`:732-737`). `button` is a labelable element, but HTML-AAM computes a button's
  name from its *contents*, and the contents here are the empty knob `<span>` —
  so whether the label text is picked up is browser-dependent. One
  `aria-label="Offer a workout snack"` (or `aria-labelledby` pointing at the span)
  removes the ambiguity.
- [ ] **Calendar day targets are 34px** (`CALENDAR_DAY_SIZE`, `App.jsx:107`),
  below the 44px iOS guideline, and the wrapping button (`:882-890`) adds no
  padding of its own. Padding the button rather than growing the disc keeps the
  grid's proportions.

## Architecture and maintainability

- [ ] **Extract the pure functions first — this is the blocker on the tests item
  below, not a separate task.** `dayBadge`, `summarize`, `daySummary`,
  `drinkCircles`, `isEmptyDay`, `plannedBase` and the whole date family
  (`dayKey`, `dateAt`, `shiftDay`, `stampOn`, `fromTimeField`, `toTimeField`) are
  already pure and are the trickiest logic in the app — but they live un-exported
  inside `App.jsx`, so none of it can be unit tested. A `src/grade.js` +
  `src/day.js` split is mechanical and risk-free, and turns the tests item from a
  large task into a small one. Do this **before** the screen split.
- [ ] Add automated tests for grading, migrations, backup validation, date
  boundaries, and 400-day trimming. (Blocked on the extraction above for
  everything except migrations, which are already exported from `storage.js`.)
- [ ] Split `App.jsx` into focused modules for the day view, history, calendar,
  dialogs, and grading logic. It is 2,265 lines routing by early `return`, with
  all 13 `useState` calls hoisted to the top even though `calendarMonth` is
  calendar-only, `confirmClearOpen` is settings-only, and
  `draft`/`dirty`/`confirmDiscard`/`editRef` are editor-only.
- [ ] **Rename the local `history`** (`App.jsx:546`) to `recentDays`. It shadows
  `window.history` inside the component. This is *not* a live bug — all nine
  `window.history` call sites are correctly prefixed, checked — but it is a loaded
  gun: a future bare `history.back()` written inside the component resolves to a
  14-element array and throws at runtime. Verified.
- [ ] Consider lifting the history/popstate guard into a named `useHistoryView()`
  hook. `editRef` (`App.jsx:267`) exists solely because the `popstate` listener is
  mounted once and cannot close over `draft`; that is well-commented today but
  fragile the next time a screen is added. Do **not** add a router dependency —
  it is a bad trade against this app's zero-dependency character, and the
  hand-rolled version is only ~40 lines.
- [ ] Put tag-level styles in `index.css` inside `@layer base`, following the
  project's Tailwind convention. Currently violated by four unlayered rules:
  `html`, `html::-webkit-scrollbar`, `body`, `body::-webkit-scrollbar`
  (`index.css:3-29`); the file contains no `@layer` at all. AGENTS.md explains
  why this matters — an unlayered `button { font: inherit }` once silently beat
  every `text-*` class in the app for months. Verified.

## Toolchain and CI

- [ ] **Add a pull-request check.** `deploy.yml` runs only on `push` to `main`
  and `workflow_dispatch`. Every change in this repo has arrived through a PR
  (#7–#25), so a build break is not caught until it has already merged and the
  deploy fails. A `pull_request` job running `npm ci && npm run build` is ~10
  lines and reuses the existing setup steps.
- [ ] **Add a lint/format step.** AGENTS.md names the absence as a known gap.
  Worth doing specifically because agents work in this repo: conventions like
  "colours come from `theme.js`, never as Tailwind classes or literal hex" are
  mechanically checkable with a `no-restricted-syntax` rule, and a convention a
  linter enforces survives better than one a doc asks for.
- [ ] Update dependencies. As of 2026-08-06: React 18.3.1 → 19.2.8, Vite 6 →
  8.2.0, `@vitejs/plugin-react` 4 → 6.0.5, Tailwind 4.0 → 4.3.3. The React 19
  bump is the only one with real migration surface.

## Housekeeping

- [ ] **Delete the README's "Things worth adding next" section** rather than
  updating it. It is confirmed stale — it lists a note field on unplanned entries
  as future work, but `EditDialog` and `UnplannedRow` shipped that — and its two
  remaining items duplicate entries in this file. Two roadmaps will drift again.
- [ ] Delete `.context/todos.md`; it is a 0-byte leftover.
- [ ] Low priority: `exportFile` revokes its object URL synchronously after
  `a.click()` on a detached anchor (`storage.js:104-112`). This works in Safari
  and Chrome today, so it is a portability nit rather than a bug; a deferred
  revoke is the robust form. Likely moot if the Share sheet item lands.
