-- Minimal stand-ins for the Supabase-managed roles and schemas the migrations use,
-- so database tests can run on a plain PostgreSQL in CI.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create schema extensions;
create schema vault;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;

create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb,
  created_at timestamptz default now()
);

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant execute on function auth.uid() to anon, authenticated;

create table vault.secrets (id uuid primary key default gen_random_uuid(), name text, secret text);
create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(p_secret text, p_name text, p_description text default null)
returns uuid
language sql as $$
  insert into vault.secrets (name, secret) values (p_name, p_secret) returning id;
$$;
