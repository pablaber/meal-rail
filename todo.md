# TODO

<!-- Remove completed items from these lists as part of the work effort. -->

## Priority: data safety and correctness

- [ ] Make backup restoration safer:
  - Validate the complete backup schema before accepting it.
  - Preview the backup's date range and entry count.
  - Confirm before replacing current data.
  - Do not report success until the restored data has been saved successfully.
  - Consider supporting both replace and merge operations.
- [ ] Handle a failed history deletion instead of reporting "History erased" when
  storage removal did not succeed.
- [ ] Distinguish corrupt stored data from a new installation and offer a recovery
  warning instead of silently opening an empty app.

## Priority: core experience

- [ ] Allow past-day corrections and backfilling, with a prominent indication of
  which date is being edited.
- [ ] Add a temporary Undo action after checking a meal or adding a snack,
  workout, or drink.
- [ ] Add a compact grade legend to the calendar and two-week history.
- [ ] Give calendar grades a visual treatment that does not depend on color alone.
- [ ] Consider replacing judgmental grade names such as "Bad" and "Terrible" with
  neutral descriptions such as "On plan", "Partial", or "Off-plan x2".
- [ ] Improve snack note capture: either open an optional note field when a snack
  is added or briefly offer an "Add details" action after one-tap logging.

## History and insights

- [ ] Add 7-day and 30-day meal-completion summaries.
- [ ] Show meal, snack, drink, and workout trends separately.
- [ ] Add weekday-versus-weekend comparisons.
- [ ] Explain the 400-day retention window and prevent the calendar from implying
  that older, trimmed dates simply had no activity.

## Data portability and onboarding

- [ ] Explain inside the app that data is stored only on the current device.
- [ ] Record and display the date of the most recent backup.
- [ ] Support the system Share sheet for sending backups to Files, AirDrop, or a
  cloud-storage app.
- [ ] Consider optional cross-device sync while keeping accounts unnecessary for
  people who only want local storage.

## Larger optional features

- [ ] Explore optional meal-time reminders configurable per slot, including the
  architectural impact of delivering reliable notifications.
- [ ] If meal slots become editable, make plan changes effective from a chosen
  date so historical days retain their original slot labels and plan.

## Accessibility and maintainability

- [ ] Add initial focus, focus trapping, Escape handling, and focus restoration to
  dialogs.
- [ ] Add automated tests for grading, migrations, backup validation, date
  boundaries, and 400-day trimming.
- [ ] Split `App.jsx` into focused modules for the day view, history, calendar,
  dialogs, and grading logic.
- [ ] Put tag-level styles in `index.css` inside `@layer base`, following the
  project's Tailwind convention.
- [ ] Update the README's "Things worth adding next" section; unplanned-entry
  notes already exist.
