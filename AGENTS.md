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
