# LeadFlow project instructions

- Work in this local codebase. Do not use Lovable services, integrations, credits, or workflows.
- Use Bun and the checked-in `bun.lock` for dependency installation and scripts.
- Supabase is the application's backend. Preserve its authentication, workspace isolation, and RLS policies.
- Put new database changes in versioned Supabase migrations. Never apply a remote migration until the target project is verified and the user has approved that application.
- Do not hand-edit generated route trees or generated Supabase types; use the project's generation workflow when available.
- Keep the existing React, TanStack Start, Tailwind, translation, and RTL/LTR conventions.
