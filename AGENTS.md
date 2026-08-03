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
src/main.jsx      entry point; registers the service worker (prod only)
src/App.jsx       the entire UI — one component plus UnplannedRow
src/storage.js    persistence; the only file that touches a storage API
src/theme.js      color and font constants
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
  settings: { slots: [{ id, label }], trainingEnabled, trainingLabel },
  days: { "YYYY-MM-DD": { checks: { [slotId]: isoTimestamp }, unplanned: [{ id, t }], training, planned } }
}
```

Days older than 400 are trimmed on every save. Changing this shape breaks existing
users' data and their backup files — migrate in `storage.js`, don't bump the key
casually.

## Deploying

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and
publishes to GitHub Pages. The workflow passes `BASE_PATH=/<repo-name>/` because
project Pages sites are served from a subpath; `vite.config.js` reads it. Never
hardcode a base path.

Bump `CACHE` in `public/sw.js` when changing the service worker's caching strategy.
