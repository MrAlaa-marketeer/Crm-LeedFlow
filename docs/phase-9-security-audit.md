# Phase 9 — Security and production audit

Audit date: 2026-11-19  
Scope: source code, checked-in SQL, Vite/Nitro build configuration, and local test/build results. No remote Supabase project, deployed Worker, or production environment was inspected. This is a repository audit, not a penetration test or production readiness certification.

## Findings

### Blockers before production

1. **Fresh database migration chain is incomplete.** The base schema is `drizzle/migrations/0000_leadflow_core_schema.sql`, while feature migrations are under `supabase/migrations/`. A fresh Supabase CLI migration run will not apply the core schema first. Do not blindly copy/replay that baseline on a live project: first compare actual remote schema and migration history, then create a reviewed baseline/repair plan. Feature SQL also assumes core tables and helper functions already exist.
2. **RLS and workspace isolation have not been verified against PostgreSQL.** Source migrations enable RLS on workspace-scoped business tables and provide member/owner policies; however, the repository has no local Postgres/Supabase test setup or automated cross-workspace/role tests. SQL correctness and actual remote policies remain unverified.
3. **No production database state or deployment was verified.** The Phase 2–8 migrations have not been applied by this audit, and no remote migration status was queried. Confirm each migration’s state in the intended project before deployment.
4. **No real scheduled notification delivery exists.** The code has transactional database triggers for selected events and in-app notification records. The inspected repository has no deployed scheduler/worker/email provider, so due-date reminders and email delivery are not production capabilities.

### High priority

- **Service role is powerful.** `SUPABASE_SERVICE_ROLE_KEY` is used by the server-only team invitation integration. It bypasses RLS by design. Keep it in server/Worker secrets only, never in `VITE_*`, client bundles, source control, or a distributable ZIP. Login/logout use the public publishable key and authenticated Supabase session.
- **Security-definer functions use inconsistent search paths.** Several functions in the core, inventory, team, and automation migrations declare `SECURITY DEFINER SET search_path = public`; activity functions use `pg_catalog, public`. Pinning `pg_catalog, public` and auditing execute grants for every definer function is a recommended follow-up. This audit did not rewrite deployed functions because the target database and migration state are unknown.
- **Role enforcement is database dependent.** UI gates do not replace SQL policies. Review all policies and RPC grants in the target database, especially membership/invitation changes and admin functions, with owner, agent, unauthenticated, and cross-workspace identities.

### Reviewed controls and limits

- Authenticated request middleware validates bearer tokens through Supabase Auth; protected application routes use the existing auth/session flow. The server-side admin client is isolated in `src/integrations/supabase/client.server.ts` and imported dynamically for server functions.
- Workspace helper functions and RLS policies are present in the SQL. Lead deletion is owner-only in the baseline; follow-up and activity access is scoped to workspace membership. Later migration policies cover inventory, invitations, assignment history, automation, and recipient-scoped notifications.
- No Storage bucket/policy or application Storage usage was found in the inspected source and SQL. If uploads are introduced, create explicit bucket policies and test workspace isolation before enabling them.
- Build configuration targets a Cloudflare Worker using Nitro’s `cloudflare-module` preset, with generated Worker configuration under `dist/server/wrangler.json`. The checked-in config does not add a static-only SPA fallback; preserve the Worker for server routes and auth callbacks.
- Root and authenticated route error components exist; retry actions invalidate/reload routes. Auth state changes invalidate the router, and sign-out clears the query cache. No explicit session-expiry or network-outage integration tests, custom retry policy, or monitoring-backed error reporting was found.
- Key workspace/date/status/assignee indexes exist in the SQL. The browser production output is approximately 1.45 MB total across split assets; the largest client chunks were reports (~383 KB), app entry (~332 KB), and Supabase client (~214 KB) before compression. Routes are emitted as separate chunks. This is a measurement, not a performance benchmark; validate on representative devices and networks.
- Supabase URL and publishable key are public client configuration, not secrets. Security depends on RLS, function grants, and correct auth settings.
- No verified error monitoring/alerting or automated backup/recovery procedure is configured in the repository. Configure and test these through the chosen production providers before onboarding customers.

## Required pre-production verification

1. Reconcile the real database with all checked-in SQL, including the missing baseline in the Supabase migration chain. Back up first and test in a disposable Supabase project.
2. Run database tests for owner/agent CRUD, workspace A versus workspace B reads/writes, invitations, role escalation, inventory links, notifications, and every RPC grant. Test with anon and authenticated JWTs.
3. Inspect `pg_policies`, function definitions/security modes/search paths, and grants in the actual project. Verify RLS is enabled and not bypassed for every exposed table.
4. Verify Supabase Auth site URL, allowed redirect URLs, login providers, password-reset redirect, email delivery, and session expiration behavior.
5. Deploy to a staging Worker, set server variables/secrets, and run the manual workflows in `deployment.md` before production.

## Evidence boundary

Static inspection can show that a policy or migration file exists; it cannot prove the SQL was applied, that a policy behaves as intended, or that the remote project is configured correctly. No remote state or credentials were queried by this audit.

## Follow-up source review — 2026-11-19

The follow-up review added `supabase/migrations/20261119000004_security_hardening.sql` and tightened the checked-in `SECURITY DEFINER` definitions to use `pg_catalog`. The membership helper now limits membership results to the caller's workspace, while preserving server service-role operations. The migration is prepared but was not run against any database; verify the target schema, grants, and migration history before applying it.

The UI now avoids rendering raw backend error details, `.env.example` uses project-neutral values, and authenticated shell navigation follows RTL/LTR direction. See [the full independent review](independent-review-2026-11-19.md) for findings, changed files, and remaining release blockers.
