# LeadFlow independent review

Review date: 2026-11-19  
Scope: supplied source archive, project documentation, client/server code, and checked-in SQL. The original project archive was not a Git checkout, so no Git diff or remote branch history was available. No production Supabase or Cloudflare environment was accessed.

## Summary

The application has a coherent React, TypeScript, TanStack Start, Supabase, and workspace-scoped RLS design. Local unit tests, TypeScript checking, and the Cloudflare production build pass. The project is **not ready for production deployment** because the database bootstrap path and live RLS behavior are not proven, there is no database-backed authorization suite, and operational controls remain unconfigured.

## Findings

### High — Fresh Supabase migration path omits the core schema

The baseline is stored in `drizzle/migrations/0000_leadflow_core_schema.sql`, while Supabase CLI migrations start with feature migrations that depend on those core tables and functions. A fresh Supabase migration run therefore cannot provision the application as-is. Reconcile the baseline and the target database migration history before applying anything; blindly replaying the baseline against a populated project can be destructive or conflict with live state.

### High — Workspace isolation and role enforcement lack database tests

Policies and membership checks are present, but the repository has no local Postgres/Supabase test harness. This review could not prove behavior for owner, agent, anonymous, service-role, or two-workspace identities. Verify the real policies and grants in a disposable Supabase project before release.

### Medium — Membership helper exposed cross-workspace membership results

`public.is_user_in_workspace(user_id, workspace_id)` was executable by authenticated users and returned a result for any workspace ID. The core definition now restricts results to the caller's workspace (or the server service role), and the forward migration applies the same change to an existing schema. This SQL has not been executed against a database; verify grants and behavior with authenticated JWTs before deployment.

### Medium — Definer functions used a writable-schema search path

Multiple `SECURITY DEFINER` functions used `search_path = public`. Source definitions and a forward migration now pin the application's definer functions to `pg_catalog`; the migration also scopes the membership helper for existing installations. This is prepared SQL only; do not treat it as active until it is reviewed against the target database and applied through the approved migration process.

### Medium — Error UI surfaced raw backend messages

Error states and several mutation handlers could show raw database, provider, or authorization messages. The UI now maps mutation failures to localized generic messages and no longer renders raw error details. Detailed server-side logs remain available for diagnosis.

### Low — Arabic shell navigation did not follow RTL direction

The desktop sidebar and mobile drawer were fixed to the left side even in Arabic. Positioning now uses logical start/end placement, and dashboard shortcuts have Arabic and English labels.

### Low — Environment template contained project-specific public values

The Supabase URL and publishable key are public configuration, not secrets, but tying the sample environment file to one project risks accidental reuse. `.env.example` now contains neutral placeholders. No service-role secret was found in the archive.

## Files changed

- `.env.example`
- `drizzle/migrations/0000_leadflow_core_schema.sql`
- `supabase/migrations/20261115000000_lead_activity_timeline.sql`
- `supabase/migrations/20261119000000_real_estate_inventory.sql`
- `supabase/migrations/20261119000001_team_management.sql`
- `supabase/migrations/20261119000003_workflow_automation_notifications.sql`
- `supabase/migrations/20261119000004_security_hardening.sql`
- `src/components/app/app-sidebar.tsx`
- `src/components/app/states.tsx`
- `src/components/app/states.test.tsx`
- `src/components/app/follow-up-form-dialog.tsx`
- `src/components/app/follow-up-item.tsx`
- `src/lib/i18n-dict.ts`
- `src/lib/mutation-errors.ts`
- `src/lib/mutation-errors.test.ts`
- `src/lib/team.functions.ts`
- `src/routes/_authenticated/dashboard.tsx`
- `src/routes/_authenticated/route.tsx`
- `src/routes/_authenticated/automation.tsx`
- `src/routes/_authenticated/leads/index.tsx`
- `src/routes/_authenticated/leads/$leadId.tsx`
- `src/routes/_authenticated/projects.tsx`
- `src/routes/_authenticated/team.tsx`
- `src/routes/auth.tsx`

## Verification

- `bun run test`: passed, 12 files and 35 tests after the code changes.
- `bunx tsc --noEmit`: passed after the code changes.
- `bun run build`: passed after the code changes for the Cloudflare Worker target.
- `bun run lint`: failed with 670 errors and 8 warnings, slightly below the original count. Findings are mostly Prettier formatting issues; no repository-wide auto-format was applied because it would create unrelated changes.
- Database migration execution, RLS tests, cross-workspace tests, browser end-to-end tests, remote configuration, backup/restore, and deployment: not run.
- Visual browser preview could not be completed because the local browser preview service returned an operational error; RTL changes were checked in source and through the production build.

## Required before production

1. Reconcile and test the baseline-plus-feature migration chain in a disposable Supabase project.
2. Run an authorization matrix covering owner, agent, anonymous, service role, and two independent workspaces. Verify table grants, RLS policies, and RPC execute grants.
3. Review the new hardening migration against the target schema and run it in staging before production.
4. Configure and test Auth redirects/providers, Cloudflare Worker variables and secrets, backups/restore, monitoring, and rollback procedures.
5. Add browser end-to-end coverage for sign-in/reset, lead lifecycle, follow-ups, invitations, and role restrictions; establish a scoped lint cleanup plan.

## Recommendation

**REQUEST CHANGES** for a production release. The code-level improvements are prepared, but database behavior and operational readiness remain unverified.
