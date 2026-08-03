# TODO

## `text-*` utilities do nothing on buttons

**Where:** `src/index.css`

```css
button,
input {
  font: inherit;
}
```

That rule sits outside any `@layer`. Unlayered CSS beats layered CSS in the
cascade regardless of specificity, and Tailwind 4 puts its utilities in
`@layer utilities` — so this rule wins over every `text-*` class on a `<button>`
or `<input>`. Every button in the app renders at the inherited 16px no matter
what it asks for.

`font` is a shorthand, so it also resets `line-height`, `font-weight`,
`font-style` and `font-family` on those elements. Any `leading-*` or `font-*`
utility on a button is dead for the same reason. Inline styles still win, which
is why the buttons that set `fontFamily` from `theme.js` look correct — the
breakage is invisible in exactly the places the project's conventions steer you
toward, which is why it survived this long.

**Confirmed, not inferred.** Deleting the rule at runtime through the CSSOM and
re-reading the computed style takes a `text-sm` button from `16px` to `14px`.

### What's affected

Buttons that declare `text-sm` and are silently rendering at 16px:

| Where | Buttons |
| --- | --- |
| `AddButton` (`src/App.jsx`) | Snack, Workout Snack, Drink |
| Settings panel | Download a backup, Restore a backup, Erase all history, Check for updates |
| `DrinkDialog` | Clear, Cancel, Save |
| `EditDialog` | Remove, Cancel, Save |

Buttons that set no `text-*` class — the meal rows, the header settings button,
the drinks count bubble, the training toggle — are unaffected either way, since
16px inherited is what they were getting and what they'd keep.

### Why it isn't fixed yet

Fixing it changes the type size of every button in the table above at once, all
of them shrinking 16px → 14px. That is a real visual change across the settings
panel and both dialogs, and it wants to be looked at deliberately rather than
ride along with an unrelated change.

### The fix

Wrap the rule so it stops outranking the utilities:

```css
@layer base {
  button,
  input {
    font: inherit;
  }
}
```

Then walk the app and re-check sizing, because the intent behind each `text-sm`
was written against a 16px render:

- the three add pills — they sit in a row with the drinks bubble and have to
  keep matching its height (see below)
- the settings panel's four buttons
- both dialogs' action rows
- anywhere `leading-*` or `font-*` on a button was silently doing nothing

Decide per button whether `text-sm` was the intent or whether it should become
`text-base` to hold the current look.

### The workaround in place

The drinks bubbles next to the Drink button deliberately carry **no** text-size
class, so they inherit 16px and match the buttons they sit beside. A `<span>`
honours `text-sm` where a `<button>` can't, so a bubble asking for it came out
14px and 4px shorter than the row. There's a comment on `BUBBLE_EDGE` in
`src/App.jsx` recording why.

Those bubbles also carry `border: 1px solid transparent` so their border box
matches the 1px dashed edge on the add buttons. That part is unrelated to this
bug and should stay after the fix.
