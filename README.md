# Community Services

## Donation chat, delivery assistance and admin completion

Current audit/setup handoff: **teamdevupdates/TEAM_UPDATE_LATEST10.txt**.
Feature handoff: **teamdevupdates/TEAM_UPDATE_LATEST8.txt**.

- Request a listed donation: choose **I can collect it myself** or **I need assistance**.
- Donate a requested item from Browse Requests: choose **I can deliver it myself**
  or **I need assistance**, and provide the pickup location.
- Both paths reserve the full listed/requested quantity and open a private chat.
  The donor and recipient can coordinate, and an assigned assistant joins that chat.
- Assistance matches a verified, training-completed, available assistant with no
  active service assignment or item delivery at matching time. When none is free,
  the request waits in Messages & deliveries for an available assistant to accept.
- Only the recipient confirms receipt. Either donor or recipient can cancel an
  unfinished arrangement; cancellation releases the listing/request. Chats become
  read-only after cancellation or receipt. Stored history remains participant-only.
- Messages use server-derived identity, safe text rendering, 2,000-character limits,
  paginated history and retry IDs. Unsent drafts are retained in the current browser
  session. Polling refreshes the visible page every 10 seconds; no push alerts,
  read receipts, attachments or distance-based matching are implemented.
- Admin pages now show real totals, searchable users, filtered/paginated requests
  and donations, and a report review queue. Moderation requires a note and creates
  an audit row. Only open unassigned requests and available unreserved donations
  can be cancelled. Reviewing a report does not claim its underlying issue is resolved.

Apply migrations **007**, **008_item_handoffs_chat.sql** and
**009_admin_operations.sql**, then **010_assistant_delivery_workload.sql**, in sequence after 001–006. They have been tested locally
but have NOT been applied to live Supabase. Deploy the updated static site alongside
these migrations. No new production dependency or environment variable is required.
The existing migration 003 expects SELECT on developer_accounts from Supabase default
privileges; ensure that grant exists as described under Developer Mode below.
Migration 010 prevents an assistant with an active item delivery from accepting a
service job; acceptance and delivery matching lock the same assistant record.
Cancelled arrangements can be started again from the original listing in the same browser.

### Fix "Chat and delivery arrangements are not available yet"

This message means the API cannot find a required chat table/function. Git commits
and GitHub Pages deployments do not run database migrations. On 30 September 2026,
the configured project's API reported missing `assistant_reviews`, `item_handoffs`,
`chat_messages` and `admin_actions` (`PGRST205`).

For a project with 001–006 installed and **none of 007–009 installed**, run:

```sh
node shared/scripts/build-workflow-setup.cjs
```

Open `test-results/community-workflows-setup.sql`, copy the entire file into your
project's Supabase SQL Editor, and run it as the database administrator. The script
includes migrations 007–010 in one transaction, preserves application data, stops
on missing prerequisites/conflicting objects, and requests an API schema refresh
after success. It does not require any private key in website code. The generator
only creates a local file; it does not connect to or update Supabase itself.

If any of 007–009 are already installed, inspect the database and apply only the
outstanding individual migrations through 010 in order. Do not rerun this bundle or remove
existing tables. If the objects exist but the API still cannot see them, run
`NOTIFY pgrst, 'reload schema';` in the trusted SQL Editor. Refresh the website after
the API reloads, then verify collection/delivery chat with separate real accounts.

The Supabase account must have access to the configured project. An account showing
no organizations and redirecting the project's SQL Editor to the organization list
cannot apply these updates. Sign in with the project owner's account or ask the
owner to apply the SQL; creating a new project will not repair the existing database.

Test the setup transaction with `node --test shared/tests/workflow-setup.test.cjs`
using the PGlite configuration below. Set `WORKFLOW_SETUP_BUNDLE=1` when running
`node shared/tests/chat-browser.cjs` to exercise the UI using the bundled setup.

## Assistant workspace completion

Previous handoff: **teamdevupdates/TEAM_UPDATE_LATEST7.txt** (assistant completion).

- The assistant dashboard now shows saved requests/jobs, bounded summary counts
  (50+ when a page is full), refresh and a persistent availability toggle.
- Assistant Profile reuses the working personal-details and avatar upload flow.
  Training shows the real overall status; there are no fabricated module records.
- Any signed-in user can read their own assistant profile/training status, including
  pending assistants. Job pages still require verification AND completed training.
- Community members can apply from the account Profile page. Applications are
  idempotent, start pending/not-started/unavailable, and cannot reset a prior review.
- Verify Assistants is connected to real records with filters, pagination, review
  dialog and saved verification/training updates. Only an actual admin can review;
  a developer preview grants no permissions. Rejection/suspension requires a reason.
- Reviews use a locked, stale-status-checked RPC and append administrator-only audit
  rows. Ineligible reviews clear availability. Availability is a preference and does
  not grant job permissions or cancel/reassign existing jobs.
- Assistant pages have consistent green styling, mobile navigation, visible active
  links, keyboard skip links, loading/error/empty states and safe text rendering.

Apply **007_assistant_management.sql** after 001–006 using the trusted Supabase
migration process. This checkout has NOT applied live migrations or deployed files.
No new environment variables, production packages or Express server are needed.
Profile/availability writes use existing RLS; application/review RPCs require 007.

## Integrated Request Help and service workflow

The team's separate Report a Problem, Request a Service and Request New Items pages
are preserved. The service page connects to My Requests and the hyphenated assistant
pages: Available Requests -> Active Jobs -> Completed Jobs. A verified assistant who
completed training can accept an open service request, start it and complete it.
Owners can cancel only open, unassigned requests.

Apply migrations 001-003, then the team's existing
`004_request_help_fields.sql`, then `005_service_request_workflow.sql`, then
`006_location_resource_problem.sql` in `shared/supabase/migrations/` using the
trusted Supabase SQL Editor or migration process. Migration 006 has not been applied
to the live project by this work. Pushing Git does not apply database SQL. Do not
apply the old option 3 backup's `004_service_request_workflow.sql`; migration 005 is
its reconciled replacement.

The team service categories and problems-addressed checkboxes are persisted.
Legacy option 3 category values remain supported. Service requests use server RPCs
with validated fields, authenticated identity, row locks and atomic request/assignment
updates. Unchanged retries reuse a UUID to avoid duplicate submissions. New request
dates use South African Standard Time. Developer Mode cannot grant permissions.

Live location: every location field (service, item, problem and donation forms)
offers a "Use my current location" button that reads the browser geolocation,
reverse geocodes it with OpenStreetMap Nominatim (no API key) and stores
latitude/longitude with the record. Request cards on My Requests and the assistant
job pages include a "Get Directions" link to Google Maps pointed at the requester's
captured coordinates, falling back to the saved address. No external API keys are
required; if geolocation or reverse geocoding is unavailable, typed addresses still
work.

My Requests keeps service, resource and problem records together, including item
name/quantity. Item creation retains a restricted own-row INSERT policy; direct
lifecycle updates are revoked. Open item cancellation uses its own RPC. Report and
donation APIs remain in place; donations accept images, uploaded to the public
`donation-images` bucket with rows in `donation_images`. The community dashboard
search lists matching donations and offers "Request this item" links into the item
request page. Reports submitted to the reports table remain separate from
My Requests. Lists show 50 records per page; filters apply to the displayed page.
Use Refresh to see other users' changes. Realtime notifications are not implemented.
Availability editing is described above.

Previous integration handoff: **`teamdevupdates/TEAM_UPDATE_LATEST6.txt`**. Updates 4 and 5 are
preserved historical snapshots; their file paths, migration numbers and Git status
statements do not describe the merged implementation.

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
Phase 1 implemented authentication and Developer Mode. Subsequent profile and
Request Help work is described above.

## Configuration and local development

1. Use Node.js 22+ and the existing Supabase project with migrations 001–010 applied for the current workflows.
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
| Assistant dashboard and job pages | Verified **and** training completed, or selected developer view |
| Assistant profile and training pages | Authenticated; only own profile/status |
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

## Integrated workflow verification

Run `node shared/tests/request-help-static.cjs` for the team page wiring and
`node shared/tests/service-browser.cjs` with the same Playwright/Edge setup. The
25 scenarios cover the merged service lifecycle, duplicate retry protection, stale
acceptance, permissions, errors, mobile layout, pagination, retained item and
report forms, live location capture, Get Directions links, dashboard donation
search and donation image upload, assistant dashboard/availability, profile persistence,
application/training status and admin review permissions. The service browser backend is mocked; no live
data is touched.

Run `node --test shared/tests/service-database.test.cjs` with
`@electric-sql/pglite` installed outside the repository. Set
`SERVICE_TEST_PGLITE` to its absolute package path or use `NODE_PATH`.
The 46 tests execute migrations 001 and 003–010 in a disposable
database, checking authorization, RLS, validation, transitions, rollback,
resource-request compatibility and the location/problem column checks. PGlite
serializes connections and does not verify real concurrent PostgreSQL lock
scheduling. Storage migration 002 is outside these workflow tests.

After database setup, test the deployed site with separate real community and
verified/trained assistant accounts. Check service creation through completion,
live location capture and directions links, item/report submission with location,
donation images, owner cancellation, competing acceptance, acceptance versus
cancellation, eligibility revocation, and actual PostgREST nested assignment reads.

## Existing limitations and next work

Admin pages are connected through migration 009. User role changes and arbitrary
status editing are intentionally excluded; use the documented review/cancellation actions.
Online training lessons/module tracking, verification-document submission, service
category preferences, realtime notifications and job reassignment are not implemented.
An administrator records training completion only after the team's actual review.
If an assistant is suspended with active work, coordinate handover with the team;
eligibility checks intentionally prevent further protected job transitions.

Browse Requests already uses the migration 006 read policy for open resource
requests. Its reusable API has also been repaired to use that policy, removing the
obsolete reference to a missing browse RPC/migration. Live database, Storage and
GitHub Pages verification remain necessary.

Live location uses the browser geolocation API and OpenStreetMap Nominatim
reverse geocoding; both need user permission and internet access, and Nominatim
has public usage limits. Where either is unavailable the forms still accept
typed addresses and directions fall back to the address text.

Team handoffs belong in **`teamdevupdates/`**. Update 10 covers the audit and current setup, update 9 covers the initial setup repair, and update 8 covers features; update 6 supersedes the historical
update 4/5 integration and Git-status instructions; older documents mentioning
`shared/docs` or a root `TEAM_UPDATE_LATEST.txt` are stale. The external option 3
backup and original newbranch remain available for comparison.

## Chat/admin integration verification

Run node shared/tests/chat-browser.cjs with Playwright, Edge and SERVICE_TEST_PGLITE
configured as above. Its 12 scenarios run the UI against the real migrations/RLS in
a disposable database, with fake Auth identities and no live Supabase access.
Coverage includes all four collection/delivery choices, waiting and matching helpers,
private cross-account messages, lost-response retries, history pagination, escaped
content, recipient receipt confirmation, admin lists, moderation and developer denial.

Latest local verification: 10 auth unit tests, all 29 auth browser scenarios,
25 service browser scenarios, 46 SQL tests, 3 setup-transaction tests and 12 chat/admin
integration scenarios (125 passed), plus static reference/syntax checks. The full
auth suite includes the two real-SDK callback cases. Set AUTH_TEST_OFFLINE=1 only
when network access is unavailable; that explicitly skips those two cases.

Before live release, test separate real accounts, PostgREST RPC signatures, actual
concurrent reservations/matching, Storage, and deployed routing. PGlite serializes
connections and does not establish real PostgreSQL concurrency behavior. A suspended
assistant loses chat access; participants can cancel and start a new assistance
arrangement if the delivery has not occurred. Automatic reassignment is not implemented.
