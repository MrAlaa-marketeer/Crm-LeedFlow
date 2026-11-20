# Deployment guide

## Current target

The checked-in Vite/Nitro configuration builds a TanStack Start application for Cloudflare Workers (`cloudflare-module`). The successful local production build writes static assets to `dist/client` and the Worker entry/configuration to `dist/server`. The generated config is `dist/server/wrangler.json`; it is build output, not a checked-in deployment manifest. TanStack Start requires the Worker for server routes and auth callbacks, so do not publish only `dist/client` as a static site or add a static-only fallback that bypasses the Worker. See Cloudflare’s [TanStack Start guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/) and [static asset routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/).

## Release steps

1. Use the checked-in Bun lockfile: `bun install --frozen-lockfile`.
2. Configure the environment variables listed in [environment-variables.md](environment-variables.md). Keep `.env.local` out of the release archive and repository.
3. Confirm the target Supabase project, Auth redirect allow-list, and database migration state. Resolve the missing core baseline migration path described in [phase-9-security-audit.md](phase-9-security-audit.md) before provisioning a fresh database.
4. Run `bun run test`, `bunx tsc --noEmit`, and `bun run build`. Review the generated `dist/server/wrangler.json` and `dist/client` output for the intended target. This repository has no checked-in CI workflow or dedicated deployment script.
5. Authenticate the Cloudflare account through its supported deployment workflow, set production Worker variables/secrets, and deploy the generated Worker configuration/output using the current Nitro/Cloudflare instructions. Verify the exact deploy command against the installed Nitro version and generated config; do not assume Vite preview is production hosting.
6. Deploy to staging first. Verify login/logout, password reset callback, protected routes, lead and follow-up operations, owner/agent permissions, and workspace isolation with separate test workspaces.
7. Promote the same reviewed build to production. Confirm logs, error reporting, backups, and rollback access before inviting customers.

## Supabase schema changes

Never apply a migration to production until the project reference and schema state are confirmed and a backup exists. The baseline schema is currently in `drizzle/migrations/0000_leadflow_core_schema.sql`, not the Supabase CLI migration directory. Feature migrations in `supabase/migrations/` depend on it. A new Supabase project therefore needs a reviewed baseline reconciliation; applying the feature migrations alone is not sufficient. For an existing project, compare migration history and actual schema before deciding whether each SQL migration is already applied. Do not replay the baseline or destructive SQL blindly.

After migrations, verify policies/functions in the remote database and run the authorization matrix documented in the security audit. The local repository contains no DB-backed integration test setup.

## Hosting and SPA behavior

The generated Worker owns routing and serves `dist/client` assets through its `ASSETS` binding. Test direct navigation and refresh on `/login`, `/forgot-password`, `/reset-password`, and authenticated routes in staging. Use the framework’s generated Worker routing; do not configure a separate static host fallback unless the app is intentionally redesigned as static-only.

## Operations and recovery

- Configure Supabase backups/PITR appropriate to the account plan; verify retention and run a restore drill in a non-production project. No backup policy is configured in this repository.
- Maintain a migration ledger and a reviewed rollback/forward-fix plan. Prefer forward fixes for production data; do not run destructive rollback SQL without impact review.
- Enable Cloudflare Worker logs and an error monitoring service chosen by the operator. No error-monitoring SDK or alert routing is configured here.
- Record who can deploy and rotate secrets. Rotate a leaked service-role key immediately in Supabase and update the Worker secret; never attach it to support tickets or ZIP files.
- Scheduled reminders/email require a real scheduler and delivery provider. The current app does not claim those capabilities; see [Phase 8 notes](phase-8-automation.md).
