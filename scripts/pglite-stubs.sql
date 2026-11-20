-- PGlite harness stubs (harness only, never applied to any real project).
-- Used by scripts/ci-migrations.mjs and by the independent verification harness.
-- Mirrors the v4/v5 stub approach: auth/storage schemas, jwt-claims-based
-- auth.uid()/auth.role(), extensions.digest via built-in sha256() (same hex
-- output as pgcrypto digest(..., 'sha256')), roles anon/authenticated/service_role.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; -- Supabase service_role bypasses RLS in production
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  instance_id uuid,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_token text,
  confirmation_sent_at timestamptz,
  recovery_token text,
  recovery_sent_at timestamptz,
  email_change_token_new text,
  email_change text,
  email_change_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz,
  updated_at timestamptz,
  phone text,
  phone_confirmed_at timestamptz,
  phone_change text,
  phone_change_token text,
  phone_change_sent_at timestamptz,
  confirmed_at timestamptz,
  email_change_token_current text,
  email_change_confirm_status smallint,
  banned_until timestamptz,
  reauthentication_token text,
  reauthentication_sent_at timestamptz,
  is_sso_user boolean DEFAULT false,
  deleted_at timestamptz
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
DECLARE c text := current_setting('request.jwt.claims', true);
BEGIN
  IF c IS NULL OR btrim(c) = '' THEN RETURN NULL; END IF;
  RETURN (c::jsonb ->> 'sub')::uuid;
EXCEPTION WHEN others THEN RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE c text := current_setting('request.jwt.claims', true);
BEGIN
  IF c IS NULL OR btrim(c) = '' THEN RETURN current_user; END IF;
  RETURN coalesce((c::jsonb ->> 'role'), current_user);
EXCEPTION WHEN others THEN RETURN current_user;
END; $$;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb,
  version text
);
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;

-- Real Supabase grants USAGE on the auth/storage schemas to the API roles;
-- without this, any direct auth.uid() call as anon/authenticated/service_role
-- fails with "permission denied for schema auth" (a harness gap, not app code).
GRANT USAGE ON SCHEMA auth, storage, extensions TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION extensions.digest(data text, algo text) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(convert_to(data, 'UTF8')) $$;
CREATE OR REPLACE FUNCTION extensions.digest(data bytea, algo text) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$ SELECT sha256(data) $$;
