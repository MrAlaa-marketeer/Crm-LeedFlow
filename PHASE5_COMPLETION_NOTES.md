# Phase 5 — Projects & Inventory

## Implementation

- Enabled the existing Projects sidebar item and added a workspace-scoped Projects & Inventory screen.
- Added developer, project, and property/unit create, edit, and (owner-only) delete flows.
- Added project/location/unit-code search and filters for project, availability, property type, and price range.
- Added real availability and project status labels in Arabic and English; the screen follows the current RTL/LTR setting.
- Added inventory search and budget/area recommendations in lead details. A lead can be linked to a project, a unit, or both. Linking does not reserve or sell a unit.
- Kept the legacy free-text `leads.interested_project` field intact. New structured associations use nullable foreign keys.
- Added lead timeline events for actual changes to those structured associations. No historical activity or real estate records are fabricated.

## Migration proposal — not applied to Supabase

Proposed migration: `supabase/migrations/20261119000000_real_estate_inventory.sql`.

It adds workspace-owned `developers`, `projects`, and `properties` tables; enum values for project status, property type, and availability; indexes; RLS policies; updated-at and write guards; and nullable lead-to-project/unit relationships. Composite foreign keys enforce that the developer, project, property, and lead belong to the same workspace. Members can manage records and only workspace owners can delete them. Projects with units or linked leads cannot be deleted until those relationships are removed; deleting a unit clears its lead link. Inventory rows are never seeded.

The current workspace model supports owner/agent membership and contains no global developer/project directory. The migration therefore scopes each inventory record to one workspace. This avoids sharing one agency's commercial inventory with other workspaces.

The migration has not been applied to any remote database. Before application, verify the intended Supabase project and review/approve this migration. After it is applied, regenerate `src/integrations/supabase/types.ts` using the project's Supabase type-generation workflow; that generated file was not hand-edited. Until migration and type regeneration, the new inventory feature uses a localized client cast because the checked-in generated schema cannot describe tables that do not exist yet.

## Verification

- `bunx tsc --noEmit` — passed.
- `bun run test` — passed (9 files, 29 tests).
- `bun run build` — passed.
- Targeted ESLint passed for the new inventory route, feature helpers, translations, and sidebar. The existing lead-detail source has pre-existing Prettier formatting findings; its ESLint rules passed when that formatting-only rule was disabled.

Remote RLS behavior and SQL execution have not been verified against Supabase because the migration is pending review/application and the local environment does not include the Supabase CLI or PostgreSQL client.
