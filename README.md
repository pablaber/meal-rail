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

Before opening a pull request, run the same checks as CI:

```bash
npm test
npm run lint
npm run format:check
npm run build
```

Use `npm run format` to apply the repository's two-space, double-quote, and
semicolon formatting conventions.

## Supabase backend development

The optional sync backend is defined by version-controlled files in `supabase/`.
It requires Docker and the PostgreSQL `psql` client for local development.
Create a separate Supabase development project with **Enable automatic RLS**
checked and **Automatically expose new tables** unchecked; migrations still
enable RLS and grant access explicitly.

Start a disposable local stack, rebuild it from the migrations, and run the
database and transaction-ordering checks:

```bash
npm run db:start
npm run db:reset
npm run test:backend
npm run db:stop
```

The first start downloads the Supabase images. Tests create isolated users and
data in the local database only; they must not run against production data.

To deploy after the local checks pass:

```bash
npx supabase login
npx supabase link --project-ref <development-project-ref>
npx supabase db push --dry-run
npx supabase db push
```

Commit `supabase/config.toml`, migrations, and tests. Keep CLI access tokens,
database passwords, secret/service-role keys, and SMTP credentials out of the
repository. A project URL and publishable key may eventually live in an ignored
`.env.local`, but a secret key must never use a `VITE_` name or enter browser
code.

For a local rollback, use `npx supabase migration down --local --last 1` and
then reset to the desired migration. Hosted migrations are forward-only:
back up the database, stop dependent clients, create a new compensating
migration with `npx supabase migration new revert_<change>`, review it with
`db push --dry-run`, and apply it normally. Do not edit hosted migration history
or rewrite an already-applied migration.

## How it's put together

React and Vite, with Tailwind for layout and a small palette in `theme.js` for
everything visual. `src/App.jsx` holds the UI, while `src/grade.js` and
`src/day.js` hold the tested domain logic. `src/storage.js` is the only file that
touches a storage API.

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

A restore always replaces the complete local data set, including settings. Meal
Rail does not merge backups: resolving two versions of the same day and two meal
plan histories needs deterministic conflict rules, so merge restore is deliberately
outside the backup workflow until those semantics are designed.

If you later want real sync, `storage.js` is the seam: `load()` and `save()` are
already async, so swapping their bodies for `fetch()` against a small service is a
change to one file. Nothing in `App.jsx` needs to know.

## Cross-device sync (in progress)

Optional sync between devices is designed but not built, and local-only stays
the default when it is. [`docs/sync-overview.md`](docs/sync-overview.md) is the
short version of how it behaves — what merges silently, what asks you to choose,
and what signing out, erasing, or restoring a backup each do to the cloud copy.
[`docs/sync-protocol-v1.md`](docs/sync-protocol-v1.md) is the full contract the
implementation is written against.
