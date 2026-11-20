# Production readiness checklist

## Repository and release

- [x] Supabase browser configuration documented; public publishable key distinguished from secrets.
- [x] Worker build target and generated output documented.
- [x] Local unit tests, typecheck, and production build pass.
- [ ] Repository-wide lint is clean (currently fails on existing formatting/lint findings).
- [ ] Add CI for typecheck, unit tests, build, migration checks, and dependency/security review.
- [ ] Add browser end-to-end tests for login, reset-password, lead lifecycle, follow-ups, and role restrictions.

## Supabase and security

- [ ] Reconcile `drizzle/migrations/0000_leadflow_core_schema.sql` with Supabase migration history; fresh database setup is currently blocked by this split.
- [ ] Verify all feature migrations against the intended project and apply only after backup/review.
- [ ] Run owner, agent, anon, and two-workspace RLS/authorization integration tests.
- [ ] Review `SECURITY DEFINER` search paths and function execute grants in the database.
- [ ] Verify Auth site URL, redirect allow-list, providers, email delivery, and session expiration in staging.
- [ ] Store service-role key only as a server secret; rotate if ever disclosed.
- [x] No application Storage use or bucket policy found in this repository.

## Operations

- [ ] Select backup/PITR policy, confirm retention, and complete a restore drill.
- [ ] Configure production error monitoring, Worker logs, alerting, and ownership.
- [ ] Document incident response and secret rotation contacts/procedure.
- [ ] Confirm a scheduler and email provider before advertising scheduled reminders or email notifications.
- [ ] Deploy to staging and complete manual smoke tests before production.
- [ ] Confirm rollback/forward-fix procedure and production access controls.

**Status:** Not production-ready based on available evidence. This repository audit did not inspect or modify remote Supabase or Cloudflare configuration.
