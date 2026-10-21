-- Identity, outlets, invitations and shared helpers.
-- Spec: design plan V0.2 ch. 4-6, 22; decisions O02-O04, O17.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
alter default privileges in schema private revoke execute on functions from public;

-- Enums ------------------------------------------------------------------

create type public.user_role as enum ('ADMIN', 'MANAGER', 'BARISTA');
create type public.user_status as enum ('INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');
create type public.app_locale as enum ('en', 'zh-CN');
create type public.invitation_status as enum ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
create type public.id_document_type as enum ('NRIC', 'PASSPORT');
create type public.measure_unit as enum ('g', 'ml');
create type public.beverage_style as enum ('COFFEE', 'TEA', 'COCKTAIL', 'MOCKTAIL', 'PREP_MATERIAL');
create type public.beverage_temp as enum ('HOT', 'COLD', 'FROZEN');
create type public.recipe_purpose as enum ('RND', 'OFFICIAL_RELEASE');
create type public.approval_status as enum ('DRAFT', 'PENDING', 'APPROVED', 'RETURNED', 'SUPERSEDED', 'ARCHIVED');
create type public.menu_status as enum ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED');
create type public.record_status as enum ('ACTIVE', 'ARCHIVED');

-- Generic row helpers ----------------------------------------------------

-- Bumps updated_at and revision; clients filter on revision for optimistic concurrency.
create function private.touch_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.revision := old.revision + 1;
  return new;
end;
$$;

-- True when the statement runs as a signed-in API user rather than inside a
-- SECURITY DEFINER business function (approve, publish, copy, ...).
create function private.is_api_caller() returns boolean
language sql stable set search_path = '' as $$
  select current_user in ('authenticated', 'anon');
$$;

-- Malaysia business date (O13: day switches at midnight Asia/Kuala_Lumpur).
create function public.my_business_date() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kuala_Lumpur')::date;
$$;

-- Outlets ----------------------------------------------------------------

create table public.outlets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9-]{2,32}$'),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1
);

create trigger outlets_touch before update on public.outlets
  for each row execute function private.touch_row();

insert into public.outlets (code, name) values
  ('JB-BROOOS', 'JB - Brooos & Co'),
  ('JB-FACTORY30', 'JB - The Factory 30'),
  ('JB-YOUBAR', 'JB - You Bar'),
  ('KL-COFFEEMAMAK', 'KL - Coffee Mamak'),
  ('KL-NEIGHBOURCLUB', 'KL - Neighbourclub'),
  ('KL-MESSENGERS', 'KL - The Messengers'),
  ('JB-CABINET8', 'JB - Cabinet 8'),
  ('KL-CABINET8', 'KL - Cabinet 8');

-- Profiles ---------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  email text not null,
  email_normalized text generated always as (lower(btrim(email))) stored unique,
  full_name text not null check (
    char_length(full_name) between 1 and 100
    and full_name = upper(full_name)
    and full_name ~ '^[[:alpha:] ''/@-]+$'
  ),
  role public.user_role not null,
  status public.user_status not null default 'ACTIVE',
  locale public.app_locale not null default 'en',
  activated_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1
);

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_row();

create table public.user_outlets (
  user_id uuid not null references public.profiles (id) on delete restrict,
  outlet_id uuid not null references public.outlets (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, outlet_id)
);
create index user_outlets_outlet_idx on public.user_outlets (outlet_id);

-- Access helpers (SECURITY DEFINER so policies can call them without recursion).

create function private.current_user_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.status = 'ACTIVE';
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_user_role() = 'ADMIN', false);
$$;

create function private.is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_user_role() = 'MANAGER', false);
$$;

-- Admin, or a Manager assigned to the outlet.
create function private.can_manage_outlet(p_outlet_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or (
    private.is_manager() and exists (
      select 1 from public.user_outlets uo
      where uo.user_id = auth.uid() and uo.outlet_id = p_outlet_id
    )
  );
$$;

-- Admin, or any active user assigned to the outlet.
create function private.is_outlet_member(p_outlet_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or (
    private.current_user_role() is not null and exists (
      select 1 from public.user_outlets uo
      where uo.user_id = auth.uid() and uo.outlet_id = p_outlet_id
    )
  );
$$;

grant execute on function private.current_user_role() to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_manager() to authenticated;
grant execute on function private.can_manage_outlet(uuid) to authenticated;
grant execute on function private.is_outlet_member(uuid) to authenticated;

-- Role / outlet shape (D02): Barista exactly one outlet, Manager at least one, Admin global.
create function private.check_user_outlets(p_user_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_role public.user_role;
  v_count integer;
begin
  select role into v_role from public.profiles where id = p_user_id;
  if v_role is null then
    return;
  end if;
  select count(*) into v_count from public.user_outlets where user_id = p_user_id;
  if v_role = 'BARISTA' and v_count <> 1 then
    raise exception 'A Barista must belong to exactly one outlet' using errcode = '23514';
  elsif v_role = 'MANAGER' and v_count < 1 then
    raise exception 'A Manager must manage at least one outlet' using errcode = '23514';
  elsif v_role = 'ADMIN' and v_count > 0 then
    raise exception 'Admin access is global; do not assign outlets' using errcode = '23514';
  end if;
end;
$$;

create function private.user_outlets_shape_trigger() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'profiles' then
    perform private.check_user_outlets(new.id);
  elsif tg_op = 'DELETE' then
    perform private.check_user_outlets(old.user_id);
  else
    perform private.check_user_outlets(new.user_id);
    if tg_op = 'UPDATE' and old.user_id <> new.user_id then
      perform private.check_user_outlets(old.user_id);
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger profiles_outlet_shape
  after insert or update of role on public.profiles
  deferrable initially deferred
  for each row execute function private.user_outlets_shape_trigger();

create constraint trigger user_outlets_shape
  after insert or update or delete on public.user_outlets
  deferrable initially deferred
  for each row execute function private.user_outlets_shape_trigger();

-- Profile guards: only Admins change role/status/identity fields; keep at least one active Admin.
create function private.profiles_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.is_api_caller() and not private.is_admin() then
    raise exception 'Only an Admin can change user records' using errcode = '42501';
  end if;
  if new.id <> old.id or new.email <> old.email then
    raise exception 'User id and email cannot be changed' using errcode = '23514';
  end if;
  if new.status in ('SUSPENDED', 'DEACTIVATED') and old.status = 'ACTIVE' then
    new.deactivated_at := now();
  elsif new.status = 'ACTIVE' and old.status <> 'ACTIVE' then
    new.deactivated_at := null;
  end if;
  if old.role = 'ADMIN' and old.status = 'ACTIVE'
     and (new.role <> 'ADMIN' or new.status <> 'ACTIVE')
     and not exists (
       select 1 from public.profiles p
       where p.role = 'ADMIN' and p.status = 'ACTIVE' and p.id <> old.id
     ) then
    raise exception 'Cannot remove the last active Admin' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function private.profiles_guard();

-- Own language preference is the only self-service profile change.
create function public.set_my_locale(p_locale public.app_locale) returns void
language sql security definer set search_path = '' as $$
  update public.profiles set locale = p_locale
  where id = auth.uid() and status = 'ACTIVE';
$$;
revoke execute on function public.set_my_locale(public.app_locale) from public, anon;
grant execute on function public.set_my_locale(public.app_locale) to authenticated;

-- Identity documents (O04): encrypted, full number Admin-only and every view logged.

create table public.user_identity (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  document_type public.id_document_type not null,
  document_number_encrypted bytea not null,
  document_last4 text not null check (char_length(document_last4) between 1 and 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1
);

create trigger user_identity_touch before update on public.user_identity
  for each row execute function private.touch_row();

create table public.identity_access_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete restrict,
  accessed_by uuid not null references public.profiles (id) on delete restrict,
  accessed_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'identity_encryption_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'identity_encryption_key',
      'Symmetric key for public.user_identity document numbers'
    );
  end if;
end;
$$;

create function private.identity_key() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'identity_encryption_key';
$$;

create function private.encrypt_identity(p_number text) returns bytea
language sql stable security definer set search_path = '' as $$
  select extensions.pgp_sym_encrypt(p_number, private.identity_key());
$$;

create function public.reveal_identity_number(p_user_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_number text;
begin
  if not private.is_admin() then
    raise exception 'Only an Admin can view full identity numbers' using errcode = '42501';
  end if;
  select extensions.pgp_sym_decrypt(document_number_encrypted, private.identity_key())
    into v_number
    from public.user_identity where user_id = p_user_id;
  if v_number is not null then
    insert into public.identity_access_log (user_id, accessed_by) values (p_user_id, auth.uid());
  end if;
  return v_number;
end;
$$;
revoke execute on function public.reveal_identity_number(uuid) from public, anon;
grant execute on function public.reveal_identity_number(uuid) to authenticated;

-- Invitations (D01, O03) -------------------------------------------------

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_normalized text generated always as (lower(btrim(email))) stored,
  role public.user_role not null,
  token_hash bytea not null unique,
  status public.invitation_status not null default 'PENDING',
  expires_at timestamptz not null default now() + interval '72 hours',
  invited_by uuid references public.profiles (id) on delete restrict,
  accepted_user_id uuid references public.profiles (id) on delete restrict,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index invitations_one_pending_per_email
  on public.invitations (email_normalized) where status = 'PENDING';

create table public.invitation_outlets (
  invitation_id uuid not null references public.invitations (id) on delete cascade,
  outlet_id uuid not null references public.outlets (id) on delete restrict,
  primary key (invitation_id, outlet_id)
);

create function private.hash_token(p_token text) returns bytea
language sql immutable set search_path = '' as $$
  select extensions.digest(p_token, 'sha256');
$$;

-- Admin creates (or re-sends) an invitation. Returns the raw token once; only its hash is stored.
create function public.create_invitation(
  p_email text,
  p_role public.user_role,
  p_outlet_ids uuid[]
) returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_outlets uuid[] := coalesce(p_outlet_ids, '{}');
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_id uuid;
  v_expires timestamptz;
begin
  if not private.is_admin() then
    raise exception 'Only an Admin can invite users' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where email_normalized = v_email) then
    raise exception 'This email already has an account; edit the user instead'
      using errcode = '23505';
  end if;
  if p_role = 'BARISTA' and cardinality(v_outlets) <> 1 then
    raise exception 'A Barista must belong to exactly one outlet' using errcode = '23514';
  elsif p_role = 'MANAGER' and cardinality(v_outlets) < 1 then
    raise exception 'A Manager must manage at least one outlet' using errcode = '23514';
  elsif p_role = 'ADMIN' and cardinality(v_outlets) > 0 then
    raise exception 'Admin access is global; do not assign outlets' using errcode = '23514';
  end if;
  if (select count(*) from public.outlets where id = any (v_outlets) and is_active)
     <> cardinality(v_outlets) then
    raise exception 'Unknown or inactive outlet' using errcode = '23503';
  end if;

  -- Re-sending replaces the previous link.
  update public.invitations
     set status = 'REVOKED', revoked_at = now()
   where email_normalized = v_email and status = 'PENDING';

  insert into public.invitations (email, role, token_hash, invited_by)
  values (v_email, p_role, private.hash_token(v_token), auth.uid())
  returning id, invitations.expires_at into v_id, v_expires;

  insert into public.invitation_outlets (invitation_id, outlet_id)
  select v_id, unnest(v_outlets);

  return query select v_id, v_token, v_expires;
end;
$$;
revoke execute on function public.create_invitation(text, public.user_role, uuid[]) from public, anon;
grant execute on function public.create_invitation(text, public.user_role, uuid[]) to authenticated;

create function public.revoke_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Only an Admin can revoke invitations' using errcode = '42501';
  end if;
  update public.invitations
     set status = 'REVOKED', revoked_at = now()
   where id = p_invitation_id and status = 'PENDING';
end;
$$;
revoke execute on function public.revoke_invitation(uuid) from public, anon;
grant execute on function public.revoke_invitation(uuid) to authenticated;

-- Public lookup for the invite page. Reveals nothing without the 256-bit token.
create function public.get_invitation(p_token text)
returns table (
  email text,
  role public.user_role,
  outlet_names text[],
  expires_at timestamptz,
  status public.invitation_status
)
language sql stable security definer set search_path = '' as $$
  select i.email,
         i.role,
         coalesce(
           (select array_agg(o.name order by o.name)
              from public.invitation_outlets io
              join public.outlets o on o.id = io.outlet_id
             where io.invitation_id = i.id),
           '{}'
         ),
         i.expires_at,
         case
           when i.status = 'PENDING' and i.expires_at <= now() then 'EXPIRED'::public.invitation_status
           else i.status
         end
    from public.invitations i
   where i.token_hash = private.hash_token(p_token);
$$;
revoke execute on function public.get_invitation(text) from public;
grant execute on function public.get_invitation(text) to anon, authenticated;

-- Sign-up hook: an auth user can only be created from a valid invitation.
-- The client passes invite_token, full_name, document_type and document_number
-- as sign-up metadata; this trigger consumes them atomically and strips them.
create function private.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}');
  v_inv public.invitations;
  v_doc_type public.id_document_type;
  v_doc_number text := upper(regexp_replace(coalesce(v_meta ->> 'document_number', ''), '\s', '', 'g'));
begin
  select * into v_inv
    from public.invitations
   where token_hash = private.hash_token(coalesce(v_meta ->> 'invite_token', ''))
   for update;

  if v_inv.id is null
     or v_inv.status <> 'PENDING'
     or v_inv.expires_at <= now()
     or v_inv.email_normalized <> lower(btrim(new.email)) then
    raise exception 'INVITATION_INVALID' using errcode = '42501';
  end if;

  begin
    v_doc_type := (v_meta ->> 'document_type')::public.id_document_type;
  exception when invalid_text_representation then
    v_doc_type := null;
  end;
  if v_doc_type is null or char_length(v_doc_number) < 4 or char_length(v_doc_number) > 32 then
    raise exception 'IDENTITY_DOCUMENT_INVALID' using errcode = '23514';
  end if;

  insert into public.profiles (id, email, full_name, role, status, activated_at)
  values (
    new.id,
    new.email,
    upper(btrim(regexp_replace(coalesce(v_meta ->> 'full_name', ''), '\s+', ' ', 'g'))),
    v_inv.role,
    'ACTIVE',
    now()
  );

  insert into public.user_outlets (user_id, outlet_id)
  select new.id, io.outlet_id
    from public.invitation_outlets io
   where io.invitation_id = v_inv.id;

  insert into public.user_identity (user_id, document_type, document_number_encrypted, document_last4)
  values (new.id, v_doc_type, private.encrypt_identity(v_doc_number), right(v_doc_number, 4));

  update public.invitations
     set status = 'ACCEPTED', accepted_user_id = new.id, accepted_at = now()
   where id = v_inv.id;

  -- Keep the token and identity number out of auth metadata and session tokens.
  update auth.users
     set raw_user_meta_data = jsonb_build_object('full_name', v_meta ->> 'full_name')
   where id = new.id;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- Settings (ch. 16) ------------------------------------------------------

create table public.app_settings (
  id boolean primary key default true check (id),
  currency text not null default 'MYR' check (currency = 'MYR'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete restrict,
  revision integer not null default 1
);
insert into public.app_settings default values;

create trigger app_settings_touch before update on public.app_settings
  for each row execute function private.touch_row();

create table public.material_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 1 and 60),
  sort_order integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1
);

create trigger material_types_touch before update on public.material_types
  for each row execute function private.touch_row();

insert into public.material_types (name, sort_order) values
  ('Alcoholic', 1), ('Liquor', 2), ('Cordial Tincture', 3), ('Tincture', 4),
  ('Cordial', 5), ('Syrup', 6), ('Base', 7), ('Juice', 8), ('Sauce', 9), ('Other', 10);

-- RLS --------------------------------------------------------------------

alter table public.outlets enable row level security;
alter table public.profiles enable row level security;
alter table public.user_outlets enable row level security;
alter table public.user_identity enable row level security;
alter table public.identity_access_log enable row level security;
alter table public.invitations enable row level security;
alter table public.invitation_outlets enable row level security;
alter table public.app_settings enable row level security;
alter table public.material_types enable row level security;

create policy outlets_select on public.outlets for select to authenticated
  using (private.current_user_role() is not null);
create policy outlets_admin_insert on public.outlets for insert to authenticated
  with check (private.is_admin());
create policy outlets_admin_update on public.outlets for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.is_admin());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy user_outlets_select on public.user_outlets for select to authenticated
  using (user_id = auth.uid() or private.is_admin());
create policy user_outlets_admin_insert on public.user_outlets for insert to authenticated
  with check (private.is_admin());
create policy user_outlets_admin_delete on public.user_outlets for delete to authenticated
  using (private.is_admin());

-- Masked identity: own row or Admin; the encrypted column is not granted to API roles.
create policy user_identity_select on public.user_identity for select to authenticated
  using (user_id = auth.uid() or private.is_admin());
revoke all on public.user_identity from anon, authenticated;
grant select (user_id, document_type, document_last4, created_at, updated_at, revision)
  on public.user_identity to authenticated;

create policy identity_access_log_select on public.identity_access_log for select to authenticated
  using (private.is_admin());

create policy invitations_select on public.invitations for select to authenticated
  using (private.is_admin());
revoke all on public.invitations from anon, authenticated;
grant select (id, email, email_normalized, role, status, expires_at, invited_by,
              accepted_user_id, accepted_at, revoked_at, created_at)
  on public.invitations to authenticated;

create policy invitation_outlets_select on public.invitation_outlets for select to authenticated
  using (private.is_admin());

create policy app_settings_select on public.app_settings for select to authenticated
  using (private.current_user_role() is not null);
create policy app_settings_admin_update on public.app_settings for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy material_types_select on public.material_types for select to authenticated
  using (private.current_user_role() is not null);
create policy material_types_admin_insert on public.material_types for insert to authenticated
  with check (private.is_admin());
create policy material_types_admin_update on public.material_types for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
