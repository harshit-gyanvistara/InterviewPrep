# Plan: Accounts and sign-in (M2.1 first slice)

**Status: built (2026-10-14)**, not yet deployed. Implements [implementationPlan.md](../implementationPlan.md) M2.1 with decision D3 (Supabase Auth). M1.6 is done; M1.7 (deploy), SMTP and the Supabase email templates are still to do before real users.

What changed from the proposal while building it:
- **No Supabase client in the browser.** Sign-in goes through Core routes (`/api/auth/otp`, `/api/auth/verify`, `/auth/google`, `/auth/callback`, `/api/auth/sign-out`), so there are no `NEXT_PUBLIC_*` keys and the code-sending endpoint is rate-limited per IP. Env vars are `SUPABASE_PUBLISHABLE_KEY` (server-side) plus the existing `SUPABASE_URL`.
- **`AUTH_MODE=off` in production fails closed** (503 on every route that needs a user, and on `/api/auth/me`) rather than refusing to start: Next has no clean "refuse to start" hook, and failing closed is testable.
- **Terms consent is clickwrap** ("By continuing you agree…" on the sign-in page), recorded at `verify` and the Google callback.
- **Sign-in and sign-out don't reload the page**: `resetSession()` in `lib/db.ts` clears the cached session and server profile.
- **Not run against a real Supabase project yet.** Unit and route tests fake the Supabase client; `supabase/tests/rls.test.ts` needs Docker (`npx supabase start`) and runs in CI's `database` job.

## Context
Today there are no accounts. Every AI route is open to anyone who can reach the server, protected only by per-IP rate limits ([lib/rateLimit.ts](../lib/rateLimit.ts), M1.2). All user data sits in `localStorage` behind the `Collection<T>` seam in [lib/db.ts](../lib/db.ts). The route guard in [components/Shell.tsx](../components/Shell.tsx) only checks whether the local profile has been onboarded.

Two things changed since D3 was written:

1. **There is now a mobile app** ([mobile/](../mobile/README.md)): an Expo shell that renders the web app in a full-screen `WebView`. Whatever sign-in we build has to work inside that WebView, and two common methods don't:
   - **Google OAuth.** Google refuses sign-in from embedded WebViews (`disallowed_useragent`).
   - **Email magic links.** The link opens in the phone's mail app or browser, so the session cookie lands there and never reaches the WebView.
2. **Supabase is already in use** for the catalog ([lib/supabase.ts](../lib/supabase.ts), `supabase/migrations/`). Auth goes in the same project.

## Goal of this slice
A user signs in on the web or in the Android app with the same email and sees the same profile. Every AI route requires a signed-in user and is rate-limited per user. Sessions, reports and the other collections stay in `localStorage` for now; they move server-side in M2.2–M2.5.

Not in this slice: orgs, server-side sessions and reports, billing, phone OTP, Google sign-in inside the app.

## Prerequisites
- **M1.6 route contract tests.** Auth adds a 401 path to every route. Tests that pin today's 400/422/502/503 behaviour should exist first, so we can see what auth changes.
- **M1.7 deploy.** Auth needs a stable origin for redirect URLs, cookies and the Supabase "Site URL". The mobile app also needs a real URL (`EXPO_PUBLIC_WEB_URL`).
- **Custom SMTP on the Supabase project** (e.g. Resend or Postmark). Supabase's built-in mailer is limited to a few emails per hour and is only meant for development.

## Decisions
| ID | Decision | Recommendation | Why |
|---|---|---|---|
| A1 | Sign-in methods | **Email one-time code** (6 digits, `signInWithOtp` + `verifyOtp`) everywhere. **Google** on the web only. Phone OTP before the public free tier (D3), not now | A code typed into the page works the same in a browser and in the WebView. Google is the lowest-friction option on the web, where it works |
| A2 | Google in the app | Hide the button inside the app for now. Later: native Google sign-in in the Expo shell, pass the ID token to `supabase.auth.signInWithIdToken`, then hand the session to the WebView | Native sign-in is a separate piece of work and email OTP covers every user meanwhile |
| A3 | Detecting the app | The shell sets `applicationNameForUserAgent="OfferlyApp/<version>"` on the WebView. The web app checks for it in one helper, `isInApp()` | One check, no client-side guessing. Also useful later for other app-only behaviour |
| A4 | Session handling | `@supabase/ssr` cookie sessions. `proxy.ts` (Next 16's renamed middleware) refreshes the token and does **optimistic** redirects only. Real checks happen in `lib/auth.ts` next to the data, as the Next docs recommend (`node_modules/next/dist/docs/01-app/02-guides/authentication.md`, "Data Access Layer") | Proxy runs on every request, including prefetches; it must not be the only line of defence |
| A5 | Who enforces data ownership | Route handlers use a **user-scoped** Supabase client (publishable key + the user's cookie), so row-level security (RLS) on `auth.uid()` enforces ownership. The secret-key client (`getSupabaseAdmin`) stays for the catalog and admin jobs | A missing `where user_id = ...` in a route can't leak another user's data |
| A6 | Running without Supabase | `AUTH_MODE=off` gives every request a fixed local user, so contributors and CI's `next build` work without secrets (same spirit as the catalog's code defaults). **With `off` under `NODE_ENV=production`, every route that needs a user fails closed (503)** | Keeps the zero-setup local workflow without risking an open production deploy |
| A7 | Existing local data | Namespace `localStorage` keys by user id. On first sign-in in a browser, adopt the un-namespaced data into that user's namespace. Uploading it to the server is M2.7 (D9) | Two people sharing a browser no longer see each other's data, and early users don't lose history |

## Data model (first auth migration)
Only what this slice needs. The org tables and the `org_id` columns on sessions, reports and usage come with the M2.2 migration that creates those tables (M2.10); nothing here has to change for them.

- `public.users`: `id uuid` primary key referencing `auth.users(id) on delete cascade`, `email`, `display_name`, `birth_year int null` (reserved for the minors policy, D15), `created_at`. Filled by a trigger on `auth.users` insert.
- `public.profiles`: `user_id` primary key referencing `users`, `data jsonb` (the existing `Profile` shape from [lib/types.ts](../lib/types.ts), validated with Zod on write), `updated_at`. JSONB keeps this migration small, matching D2.
- `public.consents`: the generic table from [plans/organisations.md](organisations.md): `user_id`, `org_id null`, `kind` text (`terms` now; later `org_share`, `guardian`, ...), `value jsonb`, `version`, `granted_at`, `revoked_at`. Sign-up records `kind = 'terms'` with the version of the terms/privacy text shown.
- RLS on all three: a user can select/insert/update only rows where `user_id = auth.uid()` (`id` for `users`). No delete policy; account deletion goes through the server (below).

## Code shape
| File | What |
|---|---|
| `lib/supabase-server.ts` | `getSupabaseForRequest()`: user-scoped client from `@supabase/ssr` using `cookies()` |
| `lib/auth.ts` (server-only) | `getUser()` (memoised per request with React `cache`, verifies the JWT with `getClaims()`), `requireUser()` throwing `ApiError(401)`. The only place that knows about `AUTH_MODE` |
| `proxy.ts` | Refresh the Supabase session; redirect signed-out page requests to `/sign-in`. Public: `/welcome`, `/sign-in`, `/auth/callback`, `/api/catalog`, static files |
| `app/sign-in/page.tsx` | Email → code form; Google button unless `isInApp()`; terms consent checkbox on first sign-in |
| `app/auth/callback/route.ts` | OAuth code exchange for Google (PKCE) |
| `app/api/db/[collection]/route.ts` | The M2.4 route, with only `profile` enabled in this slice |
| [lib/db.ts](../lib/db.ts) | `remoteCollection<T>` implementing `Collection<T>` over that route; `profile` switches to it, the rest stay local but get the per-user key prefix (A7). Change events keep working, so pages don't change |
| [lib/rateLimit.ts](../lib/rateLimit.ts) | `enforceRateLimit(req, bucket, userId?)`: key by `user:<id>` when signed in, by IP otherwise. Same `RATE_LIMITS` for now; per-user quotas from `usage_ledger` come in M2/M6 |
| `app/api/account/route.ts` | `DELETE`: deletes the auth user (cascades to `users`, `profiles`, `consents`) with the admin client, then signs out. Export already exists (`db.exportAll()`) |
| [components/Shell.tsx](../components/Shell.tsx) | Guard reads the server profile: signed out → `/welcome`; signed in without a profile → `/onboarding` |
| [mobile/src/components/WebAppView.tsx](../mobile/src/components/WebAppView.tsx) | Set `applicationNameForUserAgent` (A3) |

Every AI route (`/api/interview/turn`, `/report`, `/api/pack/generate`, `/api/roadmap`, `/api/ai/assist`, `/api/health`) calls `requireUser()` before `enforceRateLimit`. `/api/catalog` stays public.

## Work breakdown (each a PR)
1. **Plumbing.** `@supabase/ssr`, `lib/supabase-server.ts`, `lib/auth.ts` with `AUTH_MODE`, `proxy.ts`. Env vars in `.env.example` (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `AUTH_MODE`; no `NEXT_PUBLIC_*` keys, see the first rule above).
2. **Migration.** `users`, `profiles`, `consents`, trigger, RLS policies.
3. **Sign-in UI.** `/sign-in`, `/auth/callback`, sign-out in Settings, `isInApp()`, the shell's user agent change.
4. **Protect the API.** `requireUser()` in every AI route, rate limits keyed by user, 401 cases added to the M1.6 contract tests.
5. **Profile on the server.** `/api/db/[collection]` (profile only), `remoteCollection`, per-user `localStorage` prefix and adoption of existing data, new Shell guard.
6. **Account and privacy.** Terms consent at sign-up, delete account, privacy/terms pages.
7. **Docs.** SPEC.md (auth, 401, new routes, tables), USER_FLOW.md (welcome → sign-in → onboarding), README / CONTRIBUTING (`AUTH_MODE=off` for local work), mobile README (sign-in in the app).

## Tests
- Unit: `requireUser` in each `AUTH_MODE`; `AUTH_MODE=off` fails closed in production; rate-limit key is the user id when signed in.
- Contract: every AI route returns 401 without a session and behaves as before with one (`getUser` mocked).
- Isolation: against a local Supabase (`supabase start`), user A cannot read or write user B's `users`, `profiles` or `consents` rows through the publishable key. Run in CI.
- Manual before merge of step 5: sign in on desktop web and in the Android dev build with the same email; onboard on one, see the profile on the other.

## Exit
- Same email on web and in the Android app shows the same profile.
- Every AI route returns 401 without a session (tested in CI).
- Cross-user RLS tests pass in CI.
- A production server with `AUTH_MODE=off` answers 503 on every route that needs a user (tested).

## Open questions (decide later; none block this slice)
- **SMTP provider** for OTP emails, and the sender domain.
- **Session lifetime.** Supabase defaults (1 h access token, long-lived refresh token) are fine to start.
- **Native Google sign-in in the app** (A2): when app sign-up numbers justify it.
- **Phone OTP** (D3): before the public free tier; needs an SMS provider and budget, mostly for India.
