-- Menus, daily coffee calibration, cost snapshots and audit trail.
-- Spec: design plan V0.2 ch. 12-15, 22, 24.2; decisions D08-D10, D13-D15, O11-O13.

-- Menus ------------------------------------------------------------------

create table public.menus (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  status public.menu_status not null default 'DRAFT',
  published_at timestamptz,
  published_by uuid references public.profiles (id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1
);
create index menus_outlet_idx on public.menus (outlet_id);

create trigger menus_touch before update on public.menus
  for each row execute function private.touch_row();
create trigger menus_status_guard before insert or update on public.menus
  for each row execute function private.status_guard();

create function private.menus_outlet_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.outlet_id <> old.outlet_id then
    raise exception 'A menu belongs to one outlet' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger menus_outlet_guard before update on public.menus
  for each row execute function private.menus_outlet_guard();

-- Items may only use the outlet's own non-Prep recipes (A26).
create function private.menu_recipe_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_menu_outlet uuid;
  v_recipe public.recipes;
begin
  if tg_table_name = 'menu_items' then
    select outlet_id into v_menu_outlet from public.menus where id = new.menu_id;
  else
    select m.outlet_id into v_menu_outlet
      from public.menu_revisions mr join public.menus m on m.id = mr.menu_id
     where mr.id = new.menu_revision_id;
  end if;
  select * into v_recipe from public.recipes where id = new.recipe_id;
  if v_recipe.outlet_id <> v_menu_outlet then
    raise exception 'Menus can only use recipes of the same outlet; copy it first'
      using errcode = '23514';
  end if;
  if v_recipe.is_prep then
    raise exception 'Prep Material cannot be sold on a menu' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Live (published) content. Written only by the publish function, which also
-- enforces approved Official Release recipes and one price per recipe per outlet (O11).
create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.menus (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete restrict,
  price numeric(12, 2) not null check (price > 0),
  sort_order integer not null check (sort_order > 0),
  unique (menu_id, recipe_id),
  unique (menu_id, sort_order) deferrable initially deferred
);
create index menu_items_recipe_idx on public.menu_items (recipe_id);

create trigger menu_items_recipe_guard before insert or update on public.menu_items
  for each row execute function private.menu_recipe_guard();

-- Pending edits; Publish Changes swaps them in atomically (O12).
create table public.menu_revisions (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null unique references public.menus (id) on delete cascade,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1
);

create trigger menu_revisions_touch before update on public.menu_revisions
  for each row execute function private.touch_row();

create table public.menu_revision_items (
  id uuid primary key default gen_random_uuid(),
  menu_revision_id uuid not null references public.menu_revisions (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete restrict,
  price numeric(12, 2) check (price > 0),
  sort_order integer not null check (sort_order > 0),
  unique (menu_revision_id, recipe_id),
  unique (menu_revision_id, sort_order) deferrable initially deferred
);

create trigger menu_revision_items_recipe_guard before insert or update on public.menu_revision_items
  for each row execute function private.menu_recipe_guard();

-- Every publish, unpublish and automatic recipe-version switch, with what was live (D08).
create table public.menu_publish_history (
  id bigint generated always as identity primary key,
  menu_id uuid not null references public.menus (id) on delete restrict,
  outlet_id uuid not null references public.outlets (id) on delete restrict,
  event text not null check (event in ('PUBLISH', 'UNPUBLISH', 'ARCHIVE', 'RECIPE_VERSION_UPDATE')),
  snapshot jsonb not null,
  reason text,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index menu_publish_history_menu_idx on public.menu_publish_history (menu_id, created_at);

-- Daily coffee calibration (D13, D14, O13) -------------------------------

create table public.calibrations (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete restrict,
  business_date date not null default public.my_business_date(),
  coffee_bean_material_id uuid not null references public.materials (id) on delete restrict,
  dose_g numeric(8, 2) not null check (dose_g > 0),
  yield_g numeric(8, 2) not null check (yield_g > 0),
  extraction_time_seconds numeric(6, 1) not null check (extraction_time_seconds > 0),
  grind_setting text not null check (char_length(btrim(grind_setting)) between 1 and 50),
  taste_notes text,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  updated_by uuid references public.profiles (id) on delete restrict,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete restrict,
  delete_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  -- One final record per outlet, day and bean, kept even when soft-deleted.
  unique (outlet_id, business_date, coffee_bean_material_id),
  check (
    (deleted_at is null and deleted_by is null and delete_reason is null)
    or (deleted_at is not null and deleted_by is not null and char_length(btrim(delete_reason)) > 0)
  )
);

create trigger calibrations_touch before update on public.calibrations
  for each row execute function private.touch_row();

create table public.calibration_history (
  id bigint generated always as identity primary key,
  calibration_id uuid not null references public.calibrations (id) on delete restrict,
  previous jsonb not null,
  changed_by uuid references public.profiles (id) on delete restrict,
  changed_at timestamptz not null default now()
);
create index calibration_history_calibration_idx on public.calibration_history (calibration_id);

-- History rows are system-written; callers have no insert grant on the table.
create function private.record_calibration_history(p_id uuid, p_previous jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.calibration_history (calibration_id, previous, changed_by)
  values (p_id, p_previous, auth.uid());
$$;
grant execute on function private.record_calibration_history(uuid, jsonb) to authenticated;

-- Edit window and delete rights (O13): Barista today only and no delete;
-- Manager/Admin within the last 7 days and soft delete with reason.
create function private.calibrations_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_today date := public.my_business_date();
  v_is_manager boolean := private.can_manage_outlet(new.outlet_id);
begin
  if not exists (
    select 1 from public.materials
     where id = new.coffee_bean_material_id and is_coffee_bean and status = 'APPROVED') then
    raise exception 'Choose an approved coffee bean' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if new.outlet_id <> old.outlet_id
       or new.business_date <> old.business_date
       or new.coffee_bean_material_id <> old.coffee_bean_material_id then
      raise exception 'Outlet, date and bean identify the record and cannot change'
        using errcode = '23514';
    end if;
    perform private.record_calibration_history(old.id, to_jsonb(old));
  end if;
  if private.is_api_caller() then
    if v_is_manager then
      if new.business_date < v_today - 7 or new.business_date > v_today then
        raise exception 'Calibrations can be changed for the last 7 days only' using errcode = '42501';
      end if;
    elsif new.business_date <> v_today then
      raise exception 'Baristas can only record today''s calibration' using errcode = '42501';
    end if;
    if new.deleted_at is distinct from (case when tg_op = 'UPDATE' then old.deleted_at end)
       and not v_is_manager then
      raise exception 'Only a Manager or Admin can delete or restore calibrations' using errcode = '42501';
    end if;
    if new.deleted_at is not null and (tg_op = 'INSERT' or old.deleted_at is null) then
      new.deleted_by := auth.uid();
    end if;
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger calibrations_guard before insert or update on public.calibrations
  for each row execute function private.calibrations_guard();

-- Cost snapshots (D15, ch. 14) -------------------------------------------

create table public.cost_snapshots (
  id uuid primary key default gen_random_uuid(),
  recipe_version_id uuid not null references public.recipe_versions (id) on delete restrict,
  outlet_id uuid not null references public.outlets (id) on delete restrict,
  menu_id uuid references public.menus (id) on delete restrict,
  reason text not null check (reason in ('RECIPE_APPROVAL', 'MENU_PUBLISH', 'PRICE_APPROVAL')),
  total_cost numeric(18, 6),
  is_complete boolean not null,
  -- COST_INCOMPLETE reasons per line; never a silent zero (O09).
  incomplete_reasons jsonb not null default '[]',
  selling_price numeric(12, 2),
  currency text not null default 'MYR' check (currency = 'MYR'),
  calculated_at timestamptz not null default now(),
  calculated_by uuid references public.profiles (id) on delete restrict,
  check (is_complete = (total_cost is not null))
);
create index cost_snapshots_version_idx on public.cost_snapshots (recipe_version_id, calculated_at);
create index cost_snapshots_outlet_idx on public.cost_snapshots (outlet_id, calculated_at);

create table public.cost_snapshot_lines (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.cost_snapshots (id) on delete cascade,
  parent_line_id uuid references public.cost_snapshot_lines (id) on delete cascade,
  line_type text not null check (line_type in ('MATERIAL', 'PREP', 'PACKAGING')),
  display_name text not null,
  material_id uuid references public.materials (id) on delete restrict,
  pack_id uuid references public.material_packs (id) on delete restrict,
  price_version_id uuid references public.material_price_versions (id) on delete restrict,
  conversion_id uuid references public.material_conversions (id) on delete restrict,
  prep_recipe_version_id uuid references public.recipe_versions (id) on delete restrict,
  packaging_item_id uuid references public.packaging_items (id) on delete restrict,
  packaging_price_id uuid references public.packaging_prices (id) on delete restrict,
  quantity numeric(18, 6) not null check (quantity > 0),
  unit text not null check (unit in ('g', 'ml', 'piece')),
  unit_cost numeric(18, 6),
  line_cost numeric(18, 6),
  incomplete_reason text,
  check ((line_cost is null) = (incomplete_reason is not null))
);
create index cost_snapshot_lines_snapshot_idx on public.cost_snapshot_lines (snapshot_id);

-- Approval and audit trail (ch. 24.2) ------------------------------------

create table public.approval_events (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in (
    'MATERIAL', 'MATERIAL_REVISION', 'MATERIAL_PACK', 'MATERIAL_PRICE', 'MATERIAL_CONVERSION',
    'MATERIAL_COST_PACK', 'PACKAGING_ITEM', 'PACKAGING_PRICE', 'RECIPE_VERSION')),
  entity_id uuid not null,
  outlet_id uuid references public.outlets (id) on delete restrict,
  action text not null check (action in ('SUBMIT', 'WITHDRAW', 'APPROVE', 'RETURN', 'ARCHIVE', 'ROLLBACK')),
  reason text,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  check (action not in ('RETURN', 'ROLLBACK') or char_length(btrim(coalesce(reason, ''))) > 0)
);
create index approval_events_entity_idx on public.approval_events (entity_type, entity_id, created_at);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id text,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_record_idx on public.audit_events (table_name, record_id, created_at);

-- Row-level audit. TG_ARGV lists columns to leave out (secrets, encrypted data).
create function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_col text;
begin
  foreach v_col in array coalesce(tg_argv, '{}') loop
    v_old := v_old - v_col;
    v_new := v_new - v_col;
  end loop;
  insert into public.audit_events (actor_id, action, table_name, record_id, old_values, new_values)
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'user_id', v_old ->> 'user_id'),
    v_old,
    v_new
  );
  return null;
end;
$$;

create trigger audit_outlets after insert or update or delete on public.outlets
  for each row execute function private.audit_row();
create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function private.audit_row();
create trigger audit_user_outlets after insert or update or delete on public.user_outlets
  for each row execute function private.audit_row();
create trigger audit_user_identity after insert or update or delete on public.user_identity
  for each row execute function private.audit_row('document_number_encrypted');
create trigger audit_invitations after insert or update or delete on public.invitations
  for each row execute function private.audit_row('token_hash');
create trigger audit_app_settings after insert or update or delete on public.app_settings
  for each row execute function private.audit_row();
create trigger audit_material_types after insert or update or delete on public.material_types
  for each row execute function private.audit_row();
create trigger audit_materials after insert or update or delete on public.materials
  for each row execute function private.audit_row();
create trigger audit_material_revisions after insert or update or delete on public.material_revisions
  for each row execute function private.audit_row();
create trigger audit_material_packs after insert or update or delete on public.material_packs
  for each row execute function private.audit_row();
create trigger audit_material_price_versions after insert or update or delete on public.material_price_versions
  for each row execute function private.audit_row();
create trigger audit_material_conversions after insert or update or delete on public.material_conversions
  for each row execute function private.audit_row();
create trigger audit_packaging_items after insert or update or delete on public.packaging_items
  for each row execute function private.audit_row();
create trigger audit_packaging_prices after insert or update or delete on public.packaging_prices
  for each row execute function private.audit_row();
create trigger audit_recipes after insert or update or delete on public.recipes
  for each row execute function private.audit_row();
create trigger audit_recipe_versions after insert or update or delete on public.recipe_versions
  for each row execute function private.audit_row();
create trigger audit_menus after insert or update or delete on public.menus
  for each row execute function private.audit_row();
create trigger audit_menu_items after insert or update or delete on public.menu_items
  for each row execute function private.audit_row();
create trigger audit_calibrations after insert or update or delete on public.calibrations
  for each row execute function private.audit_row();

-- RLS --------------------------------------------------------------------

alter table public.menus enable row level security;
alter table public.menu_items enable row level security;
alter table public.menu_revisions enable row level security;
alter table public.menu_revision_items enable row level security;
alter table public.menu_publish_history enable row level security;
alter table public.calibrations enable row level security;
alter table public.calibration_history enable row level security;
alter table public.cost_snapshots enable row level security;
alter table public.cost_snapshot_lines enable row level security;
alter table public.approval_events enable row level security;
alter table public.audit_events enable row level security;

-- Menus: Admin all outlets, Manager own outlets (no approval, D09); Barista published only.
create policy menus_select on public.menus for select to authenticated
  using (private.can_manage_outlet(outlet_id)
         or (status = 'PUBLISHED' and private.is_outlet_member(outlet_id)));
create policy menus_insert on public.menus for insert to authenticated
  with check (private.can_manage_outlet(outlet_id) and created_by = auth.uid());
create policy menus_update on public.menus for update to authenticated
  using (private.can_manage_outlet(outlet_id)) with check (private.can_manage_outlet(outlet_id));
create policy menus_delete_draft on public.menus for delete to authenticated
  using (status = 'DRAFT' and published_at is null and private.can_manage_outlet(outlet_id));

create policy menu_items_select on public.menu_items for select to authenticated
  using (exists (
    select 1 from public.menus m
     where m.id = menu_id
       and (private.can_manage_outlet(m.outlet_id)
            or (m.status = 'PUBLISHED' and private.is_outlet_member(m.outlet_id)))));

create policy menu_revisions_all on public.menu_revisions for all to authenticated
  using (exists (select 1 from public.menus m where m.id = menu_id and private.can_manage_outlet(m.outlet_id)))
  with check (exists (select 1 from public.menus m where m.id = menu_id and private.can_manage_outlet(m.outlet_id)));

create policy menu_revision_items_all on public.menu_revision_items for all to authenticated
  using (exists (
    select 1 from public.menu_revisions mr join public.menus m on m.id = mr.menu_id
     where mr.id = menu_revision_id and private.can_manage_outlet(m.outlet_id)))
  with check (exists (
    select 1 from public.menu_revisions mr join public.menus m on m.id = mr.menu_id
     where mr.id = menu_revision_id and private.can_manage_outlet(m.outlet_id)));

create policy menu_publish_history_select on public.menu_publish_history for select to authenticated
  using (private.can_manage_outlet(outlet_id));

-- Calibration: members of the outlet read and write; deleted rows only for Manager/Admin.
create policy calibrations_select on public.calibrations for select to authenticated
  using (private.is_outlet_member(outlet_id)
         and (deleted_at is null or private.can_manage_outlet(outlet_id)));
create policy calibrations_insert on public.calibrations for insert to authenticated
  with check (private.is_outlet_member(outlet_id) and created_by = auth.uid());
create policy calibrations_update on public.calibrations for update to authenticated
  using (private.is_outlet_member(outlet_id)) with check (private.is_outlet_member(outlet_id));

create policy calibration_history_select on public.calibration_history for select to authenticated
  using (exists (
    select 1 from public.calibrations c
     where c.id = calibration_id and private.can_manage_outlet(c.outlet_id)));

-- Costs and reports: Admin all, Manager own outlets, Barista none.
create policy cost_snapshots_select on public.cost_snapshots for select to authenticated
  using (private.can_manage_outlet(outlet_id));
create policy cost_snapshot_lines_select on public.cost_snapshot_lines for select to authenticated
  using (exists (
    select 1 from public.cost_snapshots s
     where s.id = snapshot_id and private.can_manage_outlet(s.outlet_id)));

create policy approval_events_select on public.approval_events for select to authenticated
  using (private.is_admin()
         or (private.is_manager() and (outlet_id is null or private.can_manage_outlet(outlet_id))));

create policy audit_events_select on public.audit_events for select to authenticated
  using (private.is_admin());

-- API roles: anonymous visitors get no table access at all; signed-in users get
-- no direct writes on system-written tables (RLS has no write policy there either).
revoke all on all tables in schema public from anon;
revoke insert, update, delete on
  public.menu_items, public.menu_publish_history, public.calibration_history,
  public.cost_snapshots, public.cost_snapshot_lines, public.approval_events,
  public.audit_events, public.identity_access_log, public.invitation_outlets,
  public.recipe_copy_provenance
from authenticated;
