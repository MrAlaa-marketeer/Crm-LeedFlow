# Environment variables

Use `.env.example` as a local template. Do not commit `.env.local` or production secrets.

| Variable                        | Used by                                  | Value / handling                                                                                                                                                                                                                |
| ------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | Browser Supabase client                  | Supabase project URL; public configuration                                                                                                                                                                                      |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser Supabase client                  | Supabase publishable key; public by design and safe to embed when RLS is correct                                                                                                                                                |
| `SUPABASE_URL`                  | Server Supabase client                   | Same project URL; server runtime configuration                                                                                                                                                                                  |
| `SUPABASE_PUBLISHABLE_KEY`      | Server Supabase client                   | Same publishable key; server runtime configuration                                                                                                                                                                              |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server-only team invitation/admin client | Secret key that bypasses RLS. Never prefix with `VITE_`, expose to browser, commit, or put in a shareable ZIP. Required only for server-side admin operations that use `client.server.ts`; it is not required for login/logout. |

## Local setup

Copy `.env.example` to `.env.local`, then adjust the project URL and publishable key if using another Supabase project. Keep `.env.local` private. For local team invitations that require the admin client, set `SUPABASE_SERVICE_ROLE_KEY` only in the local server environment; omit it if testing only sign-in/sign-out and other public-client functionality.

## Cloudflare deployment

Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and—only if server invitation/admin features are enabled—`SUPABASE_SERVICE_ROLE_KEY` as Worker runtime variables/secrets in the production environment. Never place the service-role key in Vite client variables. Cloudflare documents [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/); Supabase documents [API keys](https://supabase.com/docs/guides/api/api-keys).

The Vite `VITE_*` variables are inlined in the browser bundle. They must contain only the project URL and publishable key, never a secret. Review built assets before release if any environment setup changes.
