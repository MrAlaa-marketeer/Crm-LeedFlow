# LeadFlow CRM

LeadFlow is an Arabic-first, bilingual CRM for real-estate agencies. It helps sales teams capture, organize, assign, and follow up with leads in workspace-isolated Supabase data.

## Product scope

- Authentication with Supabase Auth, including email/password and Google OAuth when enabled in Supabase.
- Multi-tenant workspaces protected by Supabase row-level security.
- Lead profiles, assignment, status pipeline, archive/restore, and follow-up scheduling.
- Follow-up lists for overdue, due-today, and upcoming tasks.
- A WhatsApp convenience link that opens WhatsApp with a prepared message; LeadFlow does not send messages.
- Dashboard metrics based on database records, CSV import/export, profile settings, and Arabic/English UI with RTL/LTR support.
- Clearly labeled demo data, separate from real customer records.

LeadFlow does not depend on Lovable services, credits, or infrastructure. Supabase remains the authentication and database provider.

## Local development

Install Bun, then use the checked-in lockfile:

```sh
bun install --frozen-lockfile
bun run dev
```

Configure the Supabase URL and publishable key for the browser with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The server also reads `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. `SUPABASE_SERVICE_ROLE_KEY` is server-only and must never be exposed to browser code.

See [billing rollout and Windows setup](docs/billing-rollout.md) for payment destinations, platform owner access, local database verification, and Tauri.

To enable Google sign-in, configure the Google provider and the `/auth` redirect URL in the Supabase project's Auth settings. The app uses Supabase Auth directly; Google sign-in is unavailable until those settings are configured.

Password reset redirect allow-list and manual verification steps are documented in [`docs/password-reset-setup.md`](docs/password-reset-setup.md). These are dashboard settings and must be checked in the Supabase project; the app cannot verify their remote configuration.

Production audit, environment variables, Cloudflare deployment, and outstanding readiness items are documented in:

- [`docs/phase-9-security-audit.md`](docs/phase-9-security-audit.md)
- [`docs/independent-review-2026-11-19.md`](docs/independent-review-2026-11-19.md)
- [`docs/phase-9-test-report.md`](docs/phase-9-test-report.md)
- [`docs/environment-variables.md`](docs/environment-variables.md)
- [`docs/deployment.md`](docs/deployment.md)
- [`docs/production-readiness-checklist.md`](docs/production-readiness-checklist.md)

Useful commands:

```sh
bun run test
bunx tsc --noEmit
bun run build
```

Database migrations are versioned under `supabase/migrations`. Verify the target project before applying a remote migration, preview pending changes with `supabase db push --dry-run --remote=<PROJECT_REF>`, and obtain approval before applying schema changes.
