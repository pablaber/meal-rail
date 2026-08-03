# Meal Rail

A daily meal checklist. Planned meals sit as nodes on a vertical rail through the
day; anything eaten outside those slots is logged as a mark beside the rail rather
than on it — visible, but not scored.

No accounts, no server, no calorie counting. Data lives in the browser.

## Running it

```bash
npm install
npm run dev
```

## Putting it on GitHub

```bash
git init
git add .
git commit -m "Meal Rail"
git branch -M main
git remote add origin git@github.com:<you>/meal-rail.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions.**
That single setting is the only manual step. The workflow in
`.github/workflows/deploy.yml` builds on every push to `main` and publishes to
`https://<you>.github.io/meal-rail/`.

The workflow passes `BASE_PATH=/<repo-name>/` to the build, because project Pages
sites are served from a subpath. Renaming the repo is safe; the value is derived
from the repo name at build time.

### Installing it on a phone

Open the deployed URL, then Share → Add to Home Screen. It runs full-screen and
works offline via `public/sw.js`.

## How it's put together

```
src/
  main.jsx      entry point, registers the service worker
  App.jsx       the whole UI
  storage.js    persistence — the only file that touches a storage API
  theme.js      colors and type
public/
  sw.js         offline cache
  manifest.webmanifest
```

Colors and fonts come from `theme.js` as inline styles; Tailwind handles layout
and spacing only. That split is deliberate — the palette is small enough to read
in one screen and change in one place.

## About the data

`storage.js` writes a single JSON blob to `localStorage`. That means:

- it is per-browser and per-device — no sync between your phone and laptop
- clearing site data erases it
- Safari evicts localStorage for sites unvisited for ~7 days, though installing
  to the home screen exempts it

Hence **Download a backup** and **Restore a backup** in settings. Daily use should
keep eviction from ever triggering, but take a backup occasionally.

If you later want real sync, `storage.js` is the seam: `load()` and `save()` are
already async, so swapping their bodies for `fetch()` against a small Fastify +
SQLite service is a change to one file. Nothing in `App.jsx` needs to know.

## Things worth adding next

- A note field on unplanned entries (what it was, where you were) — likely more
  informative than any count
- Notifications at slot times, if the reminder turns out to be the useful part
- A weekday-vs-weekend split in the history view
