# Community Services

## Service request workflow

Community members can submit a service request from Request Help and track it in
My Requests. Verified assistants who completed training can accept an open request,
start it from Active Jobs, and complete it. Completed Jobs and My Requests reflect
the saved status after navigation or Refresh. Owners can cancel only open requests.

Before using this feature, apply
`shared/supabase/migrations/004_service_request_workflow.sql` in the trusted Supabase
SQL Editor after migrations 001–003. This migration has **not** been applied to the
live project by this implementation. Deploy the updated static files afterward.
No Express server is needed for these pages. Test with separate real community and
verified/trained assistant accounts before release.

The migration adds create/accept/cancel/start/complete RPCs, derives identity from
Auth, validates fields, prevents self-acceptance, locks requests during transitions,
and updates assignments and requests together. A repeated creation with the same
UUID and unchanged fields returns the existing request. Direct browser writes to
requests and assignments are revoked; future resource/problem workflows need their
own reviewed RPCs. Identity-bound policy helpers also remove recursive RLS reads.
Developer Mode changes presentation only and cannot grant workflow permissions.

Preferred dates/times use SAST; new requests require today or a future date. Lists
load 50 records at a time; filters apply to the current page. Refresh retrieves
changes from other users; there are no realtime subscriptions or notifications.
Assistant dashboard eligibility comes from the signed-in account; availability is
read-only. Donations, resource requests and problem reporting remain outside this
feature. The latest team handoff is `teamdevupdates/TEAM_UPDATE_LATEST4.txt`.

## Personal profile (follow-up)

The Profile button beside Sign out opens `profile.html` for every authenticated
role. Users can edit their own first name, last name and optional phone number,
and upload, replace or remove their profile picture. Email is displayed read-only.
Developer Mode still edits the actual signed-in account.

Pictures use the existing public `avatars` bucket (JPG/PNG/WebP, maximum 5 MB).
Uploads are stored under the authenticated UUID with a unique filename; the
profile stores `avatar_path`. Save only updates the existing permitted profile
columns. No schema or role changes are needed. Image preview, validation, cancel,
save feedback and error handling are included.

Storage upload and profile update are separate operations. Old/unlinked images
are retained; a failed profile update can leave an unlinked upload. Removing a
picture clears the profile reference, not the stored object. A future storage
cleanup should handle these files. Live profile/Storage RLS checks remain required.

The follow-up handoff is `teamdevupdates/TEAM_UPDATE_LATEST3.txt`; the original Phase 1
handoff has been renamed to `teamdevupdates/TEAM_UPDATE_LATEST2.txt` in this checkout.
The Phase 1 notes below describe the earlier scope before this profile follow-up.

HTML pages with inline CSS, separate JavaScript, and Supabase Auth/PostgreSQL/RLS.
Phase 1 implemented authentication and Developer Mode. The profile and service
request sections above describe the subsequent implemented features.

## Configuration and local development

1. Use Node.js 22+ and the existing Supabase project with migrations 001–003 applied.
2. Copy `.env.example` to `.env` and set `SUPABASE_URL` and
   `SUPABASE_PUBLISHABLE_KEY` using the project's modern `sb_publishable_` key.
3. Run `node shared/scripts/configure-public.cjs` from the repository root.
   The generator writes **only** the URL and publishable key to
   `shared/frontend/public-config.js`. These two values are safe to commit and
   serve publicly. The generator rejects other key formats and never prints values.
4. Serve the repository using a local static HTTP server and open `index.html`.
   Do not open pages with `file://`. Ensure your server does not expose `.env`.

`SUPABASE_SECRET_KEY` is server-side only, is not needed for this frontend, and
must never be copied into public configuration, browser code, or commits.
Real `.env` files are ignored. `.env.example` contains names only.

GitHub Pages serves static files; it does **not** load `.env`. Deploy the generated
`public-config.js` with the HTML/JS files. No bundler is needed. The browser loads
Supabase JS **2.117.2** from jsDelivr; internet/CDN access is required. Configuration
errors fail closed with a readable message. Existing pages and filenames stay in
their role folders.

## Supabase email redirects

Set Authentication → URL Configuration → Site URL to your actual deployed base
URL, including the repository subdirectory and trailing slash. Add these exact
Redirect URLs using that same base, and equivalent URLs for your local server:

- `https://YOUR_HOST/Community_Services/auth-callback.html`
- `https://YOUR_HOST/Community_Services/reset-password.html`

Use the standard Supabase confirmation/recovery email templates linking through
`{{ .ConfirmationURL }}`. Custom token-hash-only templates need a different flow
and are not supported by this implementation. The browser SDK uses its documented
implicit flow to read the session from the redirect fragment. It removes callback
credentials from the URL. The app does not manually store tokens or passwords.
Invalid/expired callbacks show a public error. Login has a confirmation-resend action.

Signup sends only first name, last name and optional phone as metadata. The existing
database trigger creates the profile with `community_user`; no role field is sent.
Passwords require at least eight characters, matching confirmation, and any stronger
requirements configured in Supabase. Without email confirmation, signup routes the
returned session immediately; otherwise it shows a check-email message.

Recovery is recognized through the SDK's `PASSWORD_RECOVERY` event. A user-bound,
30-minute sessionStorage marker lets the recovery form survive refresh. This marker
is UI state, not an authorization grant: Supabase still requires a valid authenticated
session for `updateUser`. A normal session alone does not reveal the recovery form.
After a successful update, the current browser signs out. Existing sessions on other
devices are not explicitly revoked by this frontend.

Official references: [Auth events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange),
[password reset](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail),
[implicit flow](https://supabase.com/docs/guides/auth/sessions/implicit-flow).

## Access and routing

| Pages | Access |
| --- | --- |
| Landing, login, register, forgot password | Public |
| Confirmation callback | Public callback; trusted account checks before routing |
| Reset password | Public shell; recovery session required for form/update |
| All `community-user/frontend/*.html` | Normal community destination, or selected developer view |
| All `verified-assistant/frontend/*.html` | Verified **and** training completed, or selected developer view |
| All `admin/frontend/*.html` | Trusted `profiles.role = admin`, or selected developer view |
| `developer.html` and developer switcher | Own UUID exists in `developer_accounts` under RLS |

On each protected page, the SDK restores the session and `getUser()` verifies the
identity. Only that UUID is used to read `profiles`, `assistants`, and
`developer_accounts`. Any query failure or missing profile prevents content from
being shown. Admin routing takes precedence; otherwise verified/completed assistants
route to the assistant dashboard. Remaining supported roles (including pending
assistants and organisations without their own UI) route to community pages.

Unauthorized URLs route to the trusted destination. Empty legacy `dashboard.html`
files now use the same guards and redirect to their existing role dashboard.
Protected content starts hidden, sign-out conceals it immediately, and restored
history pages/foreground tabs recheck access. Guards improve UX; **RLS is the data
security boundary**. Public static HTML itself is downloadable.

`navigation.js` derives the base URL from its own script URL, supporting both domain
root and `/Community_Services/`. No user-controlled return URL is accepted.

## Developer Mode

Developer is a separate membership, not a profile role. Only a trusted database
operator should add membership, after creating a real Auth user and profile:

```sql
-- Replace this placeholder in the trusted Supabase SQL editor only.
insert into public.developer_accounts (user_id)
values ('YOUR_USER_UUID'::uuid);
```

Do not commit real developer identities. Migration 003 enables RLS and own-row
selection. Verify the deployed `authenticated` role has SELECT privilege on this
table; migration 003 relies on the project's default table grants. If it does not,
resolve the database setup through a reviewed change; do not bypass the check.

First developer login opens the pink/purple/flowery selector. Choices are stored in
sessionStorage under `community-services.developer-view`, bound to the user's UUID,
and honored only after database membership is checked. All three interface choices
work regardless of the developer's actual profile role; **data permissions do not
change**. No profile/assistant/developer mutations are performed by the switcher.

The floating bow button opens a native accessible dialog with Escape/close and focus
restoration. Exit Developer Mode stores `normal` for the current browser session and
returns to the real-role destination. It does not sign out or remove membership.
Logout clears view and recovery UI state and signs out the current browser session.
Princess CSS applies only to the selector and developer controls. Other interfaces
retain their original styling. Browser session storage must be available to remember
views across pages.

Developer Mode tests presentation/navigation. A developer who is really an admin
is **not** a substitute for separate real-role accounts when testing RLS.

## Verification

```sh
node --test shared/tests/auth.test.cjs
node shared/tests/check-auth-static.cjs
```

Browser regressions require the `playwright` package resolvable through Node and
installed Microsoft Edge (`npm install --no-save --package-lock=false playwright`
if unavailable). Run `node shared/tests/auth-browser.cjs`. Set `AUTH_TEST_BROWSER`
to another installed Playwright Chromium channel if needed. The test starts and
closes its own loopback server. There are 27 mocked-SDK scenarios and two scenarios
using the real pinned SDK with mocked HTTP responses. No real accounts are used.

Live release checks still required: signup/profile trigger/default role; actual
email delivery and expired links; login with all real account types; email
confirmation enabled/disabled; password recovery and subsequent new-password login;
SDK session expiry and cross-tab sign-out; developer membership grants and revocation;
direct RLS attempts with separate community, assistant, admin and developer accounts.
Also test the deployed GitHub Pages redirects and mobile browsers.

## Service workflow verification

Run `node shared/tests/service-browser.cjs` with the same Playwright setup. It tests
13 scenarios against a shared mocked backend, including the full lifecycle, stale
acceptance, unchanged creation retries, errors, permissions, XSS, mobile layout and
pagination. These tests do not contact the deployed Supabase project.

Run `node --test shared/tests/service-database.test.cjs` with
`@electric-sql/pglite` installed outside the repository. Set
`SERVICE_TEST_PGLITE` to that package's absolute path, or make it available through
`NODE_PATH`. The 21 tests execute the SQL in a disposable PostgreSQL engine,
checking RLS, authorization, validation, idempotency, transitions and rollback.
PGlite serializes connections, so true simultaneous connection/lock scheduling
still needs verification on PostgreSQL/Supabase. No live migration was applied.

Before release, apply migration 004 and repeat the full journey with real accounts,
including competing acceptance from two assistants, acceptance versus cancellation,
and eligibility revocation. Verify browser SDK/PostgREST RPC results and nested
assignment reads against the deployed project, plus GitHub Pages navigation.

## Existing limitations and next work

The static checker reports one existing missing business script reference:
`admin/frontend/admin_verify_assistants.html` references
`admin_verify-assistants.js`. Admin verification/training management and other
unconnected business screens still need their own implementation. The service
workflow requires existing verified/trained assistant records; it does not grant
these statuses. Relevant community/assistant navigation references were repaired.

Team handoffs live in **`teamdevupdates/`**. The current submission is
**`teamdevupdates/TEAM_UPDATE_LATEST4.txt`**, continuing updates 0–3. Historical
updates and master context remain intact. Older documents mentioning
`shared/docs` or a root `TEAM_UPDATE_LATEST.txt` are stale.
