# Cross-device sync: how it behaves

Status: **in progress** — designed, not built. Nothing in the app does any of
this yet. [`sync-protocol-v1.md`](sync-protocol-v1.md) is the implementation
contract; this is the short version of what it means for someone using the app.

## What syncs, and in what pieces

Not one blob. Independently versioned pieces: one per day, one for settings.
Two devices editing Tuesday and Wednesday never touch the same piece, so there
is nothing to resolve. Most would-be conflicts are never conflicts at all.

Which version is newer is decided by server-assigned revision numbers, never by
clocks. Every write says "I believe this day is at version 7"; if the server
says 8, the write bounces.

## What happens when a write bounces

Three outcomes, tried in this order:

1. **The content is already identical — adopt it silently.** Someone else, or
   your own retried request, already wrote exactly this. It is what makes
   "export from the phone, paste into the laptop, then turn sync on" silent
   rather than four hundred questions.
2. **Only one side changed — fast-forward silently.** No local edits and the
   cloud has some: take the cloud's. Or the reverse.
3. **Both sides changed the same day, differently — ask.**

Only the third ever reaches the user.

## The question

One day, or the settings, as a whole unit. **Keep this device** or **Keep
cloud**, with both versions shown: checks, notes, snacks, the workout, drinks,
and the planned count the day was graded against.

No field-level merging, deliberately. "Checks from the phone, drinks from the
laptop" produces a day that never happened on either device.

Deletes use the same two buttons and mean different things by direction:

| Situation                                   | Keep this device           | Keep cloud                  |
| ------------------------------------------- | -------------------------- | --------------------------- |
| You edited a day, another device deleted it | comes back with your edits | deleted here too            |
| You deleted a day, another device edited it | deleted everywhere         | comes back with their edits |

Settings conflict separately from days, and days conflict one at a time. Three
days plus the settings is four independent questions, each answerable whenever.

## Turning it on

- **New device, existing cloud** — downloads everything, asks nothing.
- **Existing device, empty cloud** — uploads everything, asks nothing.
- **Both have history** — days that exist on only one side merge, identical days
  merge, and only genuinely different same-dates ask. A backup is offered before
  any of it touches what is already there.

## Offline

The tap is unchanged: it is saved locally before any network work is
considered. Changes queue, push on reconnect, and converge. A failed request can
never walk back something you already saw get logged.

Requests that succeed but lose their response — normal when iOS suspends a tab —
carry an id the server remembers, so a retry gets "already did that" instead of
doing it twice.

## The parts that will surprise someone

- **Erasing local history does not delete the cloud copy.** It clears this
  device and turns sync off here. Turning sync back on downloads it all again.
- **Restoring a backup does not push deletions.** Days the cloud has and the
  backup lacks come back. A restore fixes a device; it is not a way to remove
  days.
- **Settings is one unit**, so a two-week strip preference and a meal plan
  change end up in the same question.
- **Signing out keeps everything.** Disabling sync keeps your data and discards
  only the sync bookkeeping, so re-enabling reconciles fresh rather than firing
  a months-old queue of stale changes.
