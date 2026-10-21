-- Shared purchased materials, packs, prices, conversions and packaging items.
-- Spec: design plan V0.2 ch. 7, 14, 22; decisions D03, D04, O08, O09, O10.

-- Approval-status changes (submit, approve, return, withdraw, archive) go through
-- SECURITY DEFINER business functions only. Direct API writes may create and edit
-- drafts but can never set or change the status.
create function private.status_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not private.is_api_caller() then
    return new;
  end if;
  if tg_op = 'INSERT' and new.status <> 'DRAFT' then
    raise exception 'New records start as DRAFT' using errcode = '42501';
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    raise exception 'Status changes must use the approval workflow' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Normalised text for duplicate checks: trimmed, single-spaced, lower case.
create function private.normalize_text(p text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'));
$$;

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  bucket text not null default 'recipe-media',
  object_path text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  width integer check (width > 0),
  height integer check (height > 0),
  upload_status text not null default 'PENDING' check (upload_status in ('PENDING', 'READY', 'FAILED')),
  owner_outlet_id uuid references public.outlets (id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  unique (bucket, object_path)
);

create trigger media_assets_touch before update on public.media_assets
  for each row execute function private.touch_row();

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  brand text check (brand is null or char_length(btrim(brand)) between 1 and 120),
  no_brand boolean not null default false,
  specification text check (specification is null or char_length(specification) <= 200),
  material_type_id uuid not null references public.material_types (id) on delete restrict,
  description text,
  abv numeric(5, 2) check (abv between 0 and 100),
  bx numeric(5, 2) check (bx between 0 and 100),
  is_coffee_bean boolean not null default false,
  photo_asset_id uuid references public.media_assets (id) on delete restrict,
  cost_pack_id uuid,
  status public.approval_status not null default 'DRAFT'
    check (status in ('DRAFT', 'PENDING', 'APPROVED', 'RETURNED', 'ARCHIVED')),
  name_normalized text generated always as (private.normalize_text(name)) stored,
  brand_normalized text generated always as (private.normalize_text(brand)) stored,
  specification_normalized text generated always as (private.normalize_text(specification)) stored,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  updated_by uuid references public.profiles (id) on delete restrict,
  approved_by uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  -- "No brand" is explicit, never an empty brand (ch. 19.2).
  check ((no_brand and brand is null) or (not no_brand and brand is not null))
);
-- Same brand + product + specification is one shared record (D03, A07).
create unique index materials_identity_unique
  on public.materials (name_normalized, brand_normalized, specification_normalized)
  where status <> 'ARCHIVED';

create trigger materials_touch before update on public.materials
  for each row execute function private.touch_row();
create trigger materials_status_guard before insert or update on public.materials
  for each row execute function private.status_guard();

-- Submitted or approved materials are edited only through proposals; brand or
-- product changes need a new material (D04, A11).
create function private.materials_edit_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'DRAFT' and old.status <> 'RETURNED' and private.is_api_caller() then
    raise exception 'Submitted or approved materials change only through a revision proposal'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger materials_edit_guard before update on public.materials
  for each row execute function private.materials_edit_guard();

-- Proposed changes to an approved material; the approved record stays current until approval.
create table public.material_revisions (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials (id) on delete restrict,
  material_type_id uuid not null references public.material_types (id) on delete restrict,
  description text,
  abv numeric(5, 2) check (abv between 0 and 100),
  bx numeric(5, 2) check (bx between 0 and 100),
  is_coffee_bean boolean not null default false,
  photo_asset_id uuid references public.media_assets (id) on delete restrict,
  status public.approval_status not null default 'DRAFT'
    check (status in ('DRAFT', 'PENDING', 'APPROVED', 'RETURNED')),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1
);
create unique index material_revisions_one_open
  on public.material_revisions (material_id) where status in ('DRAFT', 'PENDING', 'RETURNED');

create trigger material_revisions_touch before update on public.material_revisions
  for each row execute function private.touch_row();
create trigger material_revisions_status_guard before insert or update on public.material_revisions
  for each row execute function private.status_guard();

create table public.material_packs (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials (id) on delete restrict,
  pack_quantity numeric(18, 6) not null check (pack_quantity > 0),
  unit public.measure_unit not null,
  description text,
  status public.approval_status not null default 'DRAFT'
    check (status in ('DRAFT', 'PENDING', 'APPROVED', 'RETURNED', 'ARCHIVED')),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  approved_by uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  unique (id, material_id)
);
-- Same pack size twice on one product is a duplicate (ch. 19.4).
create unique index material_packs_unique_size
  on public.material_packs (material_id, pack_quantity, unit) where status <> 'ARCHIVED';

create trigger material_packs_touch before update on public.material_packs
  for each row execute function private.touch_row();
create trigger material_packs_status_guard before insert or update on public.material_packs
  for each row execute function private.status_guard();

-- One current costing pack per product, which must belong to it (O10).
alter table public.materials
  add constraint materials_cost_pack_fk
  foreign key (cost_pack_id, id) references public.material_packs (id, material_id)
  deferrable initially deferred;

-- Switching the costing pack of an approved material needs Admin approval (O10).
create function private.materials_cost_pack_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.is_api_caller() and old.status = 'APPROVED'
     and new.cost_pack_id is distinct from old.cost_pack_id then
    raise exception 'Changing the costing pack must use the approval workflow'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger materials_cost_pack_guard before update on public.materials
  for each row execute function private.materials_cost_pack_guard();

create table public.material_price_versions (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.material_packs (id) on delete restrict,
  price numeric(14, 4) not null check (price >= 0),
  -- Free items need an explicit zero with a reason; blanks never become zero (ch. 7.3).
  free_reason text,
  currency text not null default 'MYR' check (currency = 'MYR'),
  status public.approval_status not null default 'DRAFT'
    check (status in ('DRAFT', 'PENDING', 'APPROVED', 'RETURNED', 'SUPERSEDED')),
  effective_from timestamptz,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  approved_by uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  check (price > 0 or char_length(btrim(coalesce(free_reason, ''))) > 0),
  check ((status in ('APPROVED', 'SUPERSEDED')) = (effective_from is not null))
);
create unique index material_price_versions_one_current
  on public.material_price_versions (pack_id) where status = 'APPROVED';
create index material_price_versions_pack_idx on public.material_price_versions (pack_id, effective_from);

create trigger material_price_versions_touch before update on public.material_price_versions
  for each row execute function private.touch_row();
create trigger material_price_versions_status_guard before insert or update on public.material_price_versions
  for each row execute function private.status_guard();

-- Product-specific g/ml conversion; no default 1:1 (ch. 7.3, A12).
create table public.material_conversions (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials (id) on delete restrict,
  grams_per_ml numeric(18, 6) not null check (grams_per_ml > 0),
  source text not null check (char_length(btrim(source)) > 0),
  conditions text,
  status public.approval_status not null default 'DRAFT'
    check (status in ('DRAFT', 'PENDING', 'APPROVED', 'RETURNED', 'SUPERSEDED')),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  approved_by uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1
);
create unique index material_conversions_one_current
  on public.material_conversions (material_id) where status = 'APPROVED';

create trigger material_conversions_touch before update on public.material_conversions
  for each row execute function private.touch_row();
create trigger material_conversions_status_guard before insert or update on public.material_conversions
  for each row execute function private.status_guard();

-- Packaging priced per piece (O08).
create table public.packaging_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  brand text,
  description text,
  status public.approval_status not null default 'DRAFT'
    check (status in ('DRAFT', 'PENDING', 'APPROVED', 'RETURNED', 'ARCHIVED')),
  name_normalized text generated always as (private.normalize_text(name)) stored,
  brand_normalized text generated always as (private.normalize_text(brand)) stored,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  approved_by uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1
);
create unique index packaging_items_identity_unique
  on public.packaging_items (name_normalized, brand_normalized) where status <> 'ARCHIVED';

create trigger packaging_items_touch before update on public.packaging_items
  for each row execute function private.touch_row();
create trigger packaging_items_status_guard before insert or update on public.packaging_items
  for each row execute function private.status_guard();

create table public.packaging_prices (
  id uuid primary key default gen_random_uuid(),
  packaging_item_id uuid not null references public.packaging_items (id) on delete restrict,
  price_per_piece numeric(14, 4) not null check (price_per_piece >= 0),
  free_reason text,
  currency text not null default 'MYR' check (currency = 'MYR'),
  status public.approval_status not null default 'DRAFT'
    check (status in ('DRAFT', 'PENDING', 'APPROVED', 'RETURNED', 'SUPERSEDED')),
  effective_from timestamptz,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  approved_by uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  check (price_per_piece > 0 or char_length(btrim(coalesce(free_reason, ''))) > 0),
  check ((status in ('APPROVED', 'SUPERSEDED')) = (effective_from is not null))
);
create unique index packaging_prices_one_current
  on public.packaging_prices (packaging_item_id) where status = 'APPROVED';

create trigger packaging_prices_touch before update on public.packaging_prices
  for each row execute function private.touch_row();
create trigger packaging_prices_status_guard before insert or update on public.packaging_prices
  for each row execute function private.status_guard();

-- RLS --------------------------------------------------------------------
-- Admin: everything. Manager: read all shared data and prices, create and edit drafts.
-- Barista: no prices; material names only through SOP visibility (see recipes migration).

alter table public.media_assets enable row level security;
alter table public.materials enable row level security;
alter table public.material_revisions enable row level security;
alter table public.material_packs enable row level security;
alter table public.material_price_versions enable row level security;
alter table public.material_conversions enable row level security;
alter table public.packaging_items enable row level security;
alter table public.packaging_prices enable row level security;

create function private.is_admin_or_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.current_user_role() in ('ADMIN', 'MANAGER');
$$;
grant execute on function private.is_admin_or_manager() to authenticated;

-- Materials (Barista read policy is added with recipes).
create policy materials_select_staff on public.materials for select to authenticated
  using (private.is_admin_or_manager());
create policy materials_insert on public.materials for insert to authenticated
  with check (private.is_admin_or_manager() and created_by = auth.uid());
create policy materials_update on public.materials for update to authenticated
  using (private.is_admin_or_manager()) with check (private.is_admin_or_manager());
create policy materials_delete_draft on public.materials for delete to authenticated
  using (status = 'DRAFT' and (private.is_admin() or created_by = auth.uid()));

-- Same pattern for every proposal-style table.
create policy material_revisions_select on public.material_revisions for select to authenticated
  using (private.is_admin_or_manager());
create policy material_revisions_insert on public.material_revisions for insert to authenticated
  with check (private.is_admin_or_manager() and created_by = auth.uid());
create policy material_revisions_update on public.material_revisions for update to authenticated
  using (private.is_admin_or_manager() and status in ('DRAFT', 'RETURNED'))
  with check (private.is_admin_or_manager());
create policy material_revisions_delete on public.material_revisions for delete to authenticated
  using (status = 'DRAFT' and (private.is_admin() or created_by = auth.uid()));

create policy material_packs_select on public.material_packs for select to authenticated
  using (private.is_admin_or_manager());
create policy material_packs_insert on public.material_packs for insert to authenticated
  with check (private.is_admin_or_manager() and created_by = auth.uid());
create policy material_packs_update on public.material_packs for update to authenticated
  using (private.is_admin_or_manager() and status in ('DRAFT', 'RETURNED'))
  with check (private.is_admin_or_manager());
create policy material_packs_delete on public.material_packs for delete to authenticated
  using (status = 'DRAFT' and (private.is_admin() or created_by = auth.uid()));

create policy material_price_versions_select on public.material_price_versions for select to authenticated
  using (private.is_admin_or_manager());
create policy material_price_versions_insert on public.material_price_versions for insert to authenticated
  with check (private.is_admin_or_manager() and created_by = auth.uid());
create policy material_price_versions_update on public.material_price_versions for update to authenticated
  using (private.is_admin_or_manager() and status in ('DRAFT', 'RETURNED'))
  with check (private.is_admin_or_manager());
create policy material_price_versions_delete on public.material_price_versions for delete to authenticated
  using (status = 'DRAFT' and (private.is_admin() or created_by = auth.uid()));

create policy material_conversions_select on public.material_conversions for select to authenticated
  using (private.is_admin_or_manager());
create policy material_conversions_insert on public.material_conversions for insert to authenticated
  with check (private.is_admin_or_manager() and created_by = auth.uid());
create policy material_conversions_update on public.material_conversions for update to authenticated
  using (private.is_admin_or_manager() and status in ('DRAFT', 'RETURNED'))
  with check (private.is_admin_or_manager());
create policy material_conversions_delete on public.material_conversions for delete to authenticated
  using (status = 'DRAFT' and (private.is_admin() or created_by = auth.uid()));

create policy packaging_items_select on public.packaging_items for select to authenticated
  using (private.is_admin_or_manager());
create policy packaging_items_insert on public.packaging_items for insert to authenticated
  with check (private.is_admin_or_manager() and created_by = auth.uid());
create policy packaging_items_update on public.packaging_items for update to authenticated
  using (private.is_admin_or_manager() and status in ('DRAFT', 'RETURNED'))
  with check (private.is_admin_or_manager());
create policy packaging_items_delete on public.packaging_items for delete to authenticated
  using (status = 'DRAFT' and (private.is_admin() or created_by = auth.uid()));

create policy packaging_prices_select on public.packaging_prices for select to authenticated
  using (private.is_admin_or_manager());
create policy packaging_prices_insert on public.packaging_prices for insert to authenticated
  with check (private.is_admin_or_manager() and created_by = auth.uid());
create policy packaging_prices_update on public.packaging_prices for update to authenticated
  using (private.is_admin_or_manager() and status in ('DRAFT', 'RETURNED'))
  with check (private.is_admin_or_manager());
create policy packaging_prices_delete on public.packaging_prices for delete to authenticated
  using (status = 'DRAFT' and (private.is_admin() or created_by = auth.uid()));
