# Meal Rail

A daily meal checklist. Planned meals sit as nodes on a vertical rail through the
day; anything eaten outside those slots is logged as a mark beside the rail rather
than on it — visible, but not scored.

Local-first, with an optional email-code identity for future sync. Meal data stays in the browser unless sync is explicitly enabled.

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

## Email OTP authentication

Email sign-in identifies an optional sync account; signing in alone does not
upload or enable sync. The app continues to log meals locally when Auth is
signed out, offline, unavailable, or unconfigured.

### Local setup

After starting the local stack, run `npx supabase status -o env`. Copy
`.env.example` to ignored `.env.local` and set:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key from supabase status>
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

Use the local legacy anon key only when this Supabase CLI does not expose a
publishable key. Inbucket at `http://127.0.0.1:54324` receives local OTP mail.
The local configuration uses Cloudflare's public always-pass Turnstile test
pair; never use a real Resend key locally.

### Hosted operator runbook

1. In Resend, verify a dedicated `auth.<your-domain>` sending subdomain. Add
   its generated SPF/MX and DKIM DNS records. Start
   `_dmarc.auth.<your-domain>` at `v=DMARC1; p=none; rua=mailto:<report-mailbox>;`;
   after verified delivery, move to `p=quarantine` or `p=reject`. Disable
   click/open tracking for this transactional sender.
2. Create a Resend sending-only API key. In Supabase **Authentication → SMTP**,
   use `smtp.resend.com`, port `465`, username `resend`, that API key as the
   password, sender name `Meal Rail`, and
   `sign-in@auth.<your-domain>` as the sender address.
3. In hosted Supabase Auth, retain email signup, leave anonymous/password UI
   unused, set OTP length `6`, expiry `600` seconds, resend `60` seconds,
   email sends `6/hour`, sign-up/sign-in requests `10/five minutes/IP`, and
   token verifications `10/five minutes/IP`. Copy
   `supabase/templates/magic_link.html` into the **Magic Link or OTP** template
   with subject `Your Meal Rail sign-in code`; confirm rendered mail has no link.
4. Create a Cloudflare Turnstile Managed widget restricted to
   `pablaber.github.io`. Put its public site key in the GitHub Actions variable
   `VITE_TURNSTILE_SITE_KEY`. Put its secret only in Supabase
   **Authentication → Attack Protection → CAPTCHA**, selecting Turnstile.
5. In Supabase **Authentication → URL Configuration**, set Site URL to
   `https://pablaber.github.io/meal-rail/` and allow exactly
   `http://127.0.0.1:5173` and `http://localhost:5173` for development.
6. Add GitHub repository **Actions variables** (not secrets):
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and
   `VITE_TURNSTILE_SITE_KEY`. Vite intentionally publishes these identifiers.

Never place `RESEND_API_KEY`, the Turnstile secret, Supabase secret/service-role
keys, `SUPABASE_ACCESS_TOKEN`, or database passwords in a `VITE_` variable,
GitHub Pages build variables, browser code, screenshots, or committed files.
The Resend and Turnstile secrets belong only in hosted Supabase configuration.

### Production Auth configuration deployment

`supabase/config.toml` contains the local-stack baseline and a
`[remotes.production]` override for project `lwtgpdohoprfpjykjoee`. When
`config push` targets that project, Supabase merges the remote Auth settings:
the hosted URL, Turnstile secret, and Resend SMTP configuration override the
local values without replacing the local contract.

After Resend DNS is verified, copy `.env.example` to `.env` and replace every
mock value. Then load those ignored values and push the named production
remote:

```bash
set -a
. ./.env
set +a
npx supabase config push --project-ref "$SUPABASE_PROJECT_ID"
```

This requires `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`,
`TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, and `SMTP_SENDER_EMAIL`. Do not put
any of them in a `VITE_` variable or GitHub Pages build environment.

### Production validation

Request codes for both a new and a returning address; both must show the same
generic confirmation. Verify delivered mail contains a six-digit code and no
link; invalid, expired, reused, rapid-resend, and excess-attempt cases must not
reveal account existence. Check delivered headers for SPF, DKIM, and DMARC pass;
install/relaunch the PWA to confirm the session persists; sign out one of two
devices and confirm the other stays signed in. Finally, take one device offline
during Auth and confirm local meal logging remains usable.

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
