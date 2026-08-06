# Meal Rail

A daily meal checklist. Planned meals sit as nodes on a vertical rail through the
day; anything eaten outside those slots is logged as a mark beside the rail rather
than on it — visible, but not scored.

No accounts, no server, no calorie counting. Data lives in the browser.

It installs as a PWA — open the deployed URL, then Share → Add to Home Screen. It
runs full-screen and works offline.

An installed copy checks for a new release each time you bring it to the
foreground, and reloads itself when it finds one. Settings shows the version
you're running and has a **Check for updates** button for when you don't want to
wait.

## Running it

```bash
npm install
npm run dev
```

## How it's put together

React and Vite, with Tailwind for layout and a small palette in `theme.js` for
everything visual. `src/App.jsx` is the whole UI; `src/storage.js` is the only file
that touches a storage API.

## About the data

`storage.js` writes a single JSON blob to `localStorage`. That means:

- it is per-browser and per-device — no sync between your phone and laptop
- clearing site data erases it
- Safari evicts localStorage for sites unvisited for ~7 days, though installing
  to the home screen exempts it

Hence the **Your data** grid in settings: back up to a file or to the clipboard,
restore from either. A file is what you keep; the clipboard is for moving a backup
to another device without one — copy it, paste it into a message to yourself, and
paste it back in over there. Daily use should keep eviction from ever triggering,
but take a backup occasionally.

If you later want real sync, `storage.js` is the seam: `load()` and `save()` are
already async, so swapping their bodies for `fetch()` against a small service is a
change to one file. Nothing in `App.jsx` needs to know.

## Things worth adding next

- A note field on unplanned entries (what it was, where you were) — likely more
  informative than any count
- Notifications at slot times, if the reminder turns out to be the useful part
- A weekday-vs-weekend split in the history view
