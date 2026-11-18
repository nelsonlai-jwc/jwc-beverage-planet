-- Filter Calibration (Nelson, 2026-11-18): brewers per outlet, one final record per
-- outlet, day, bean and brewer, test brews and target ranges per bean.

-- Brewers (Settings, Super Admin) ------------------------------------------

create table public.brewers (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  brand text check (char_length(brand) <= 60),
  model text check (char_length(model) <= 60),
  brewer_type text not null default 'POUR_OVER' check (brewer_type in ('POUR_OVER', 'BATCH')),
  serial_number text check (char_length(serial_number) <= 80),
  notes text check (char_length(notes) <= 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  unique (outlet_id, name)
);
create trigger brewers_touch before update on public.brewers
  for each row execute function private.touch_row();
create trigger audit_brewers after insert or update or delete on public.brewers
  for each row execute function private.audit_row();

alter table public.brewers enable row level security;
create policy brewers_select on public.brewers for select to authenticated using (true);
create policy brewers_insert on public.brewers for insert to authenticated with check (private.is_admin());
create policy brewers_update on public.brewers for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
revoke all on public.brewers from anon;
revoke delete on public.brewers from authenticated;

-- Shared checks -------------------------------------------------------------

create function private.filter_equipment_ok(p_outlet_id uuid, p_brewer_id uuid, p_grinder_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.brewers b
                  where b.id = p_brewer_id and b.outlet_id = p_outlet_id and b.is_active)
     and exists (select 1 from public.grinders g
                  where g.id = p_grinder_id and g.outlet_id = p_outlet_id and g.is_active);
$$;
grant execute on function private.filter_equipment_ok(uuid, uuid, uuid) to authenticated;

-- Same date window as espresso: Barista today only; Manager/Admin last 7 days.
create function private.calibration_window_ok(p_outlet_id uuid, p_date date) returns void
language plpgsql stable set search_path = '' as $$
declare
  v_today date := public.my_business_date();
begin
  if not private.is_api_caller() then
    return;
  end if;
  if private.can_manage_outlet(p_outlet_id) then
    if p_date < v_today - 7 or p_date > v_today then
      raise exception 'Calibrations can be changed for the last 7 days only' using errcode = '42501';
    end if;
  elsif p_date <> v_today then
    raise exception 'Baristas can only record today''s calibration' using errcode = '42501';
  end if;
end;
$$;
grant execute on function private.calibration_window_ok(uuid, date) to authenticated;

-- Final records -------------------------------------------------------------

create table public.filter_calibrations (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete restrict,
  business_date date not null default public.my_business_date(),
  coffee_bean_material_id uuid not null references public.materials (id) on delete restrict,
  brewer_id uuid not null references public.brewers (id) on delete restrict,
  grinder_id uuid not null references public.grinders (id) on delete restrict,
  grind_setting text not null check (char_length(btrim(grind_setting)) between 1 and 50),
  dose_g numeric(8, 2) not null check (dose_g > 0),
  water_g numeric(8, 1) not null check (water_g > 0),
  water_temp_c numeric(4, 1) check (water_temp_c between 70 and 100),
  bloom_water_g numeric(7, 1) check (bloom_water_g >= 0),
  bloom_seconds numeric(5, 1) check (bloom_seconds >= 0),
  pour_count integer check (pour_count between 1 and 20),
  total_time_seconds numeric(6, 1) not null check (total_time_seconds > 0),
  beverage_g numeric(8, 1) check (beverage_g > 0),
  tds_percent numeric(5, 2) check (tds_percent > 0 and tds_percent <= 25),
  roast_date date,
  taste_balance text check (taste_balance in ('SOUR', 'BALANCED', 'BITTER')),
  taste_notes text check (char_length(taste_notes) <= 1000),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  updated_by uuid references public.profiles (id) on delete restrict,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete restrict,
  delete_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  unique (outlet_id, business_date, coffee_bean_material_id, brewer_id),
  check (roast_date is null or roast_date <= business_date),
  check (
    (deleted_at is null and deleted_by is null and delete_reason is null)
    or (deleted_at is not null and deleted_by is not null and char_length(btrim(delete_reason)) > 0)
  )
);
create trigger filter_calibrations_touch before update on public.filter_calibrations
  for each row execute function private.touch_row();
create trigger audit_filter_calibrations after insert or update or delete on public.filter_calibrations
  for each row execute function private.audit_row();

create function private.filter_calibrations_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.materials
     where id = new.coffee_bean_material_id and is_coffee_bean and status = 'APPROVED') then
    raise exception 'Choose an approved coffee bean' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (
       new.outlet_id <> old.outlet_id or new.business_date <> old.business_date
       or new.coffee_bean_material_id <> old.coffee_bean_material_id or new.brewer_id <> old.brewer_id) then
    raise exception 'Outlet, date, bean and brewer identify the record and cannot change' using errcode = '23514';
  end if;
  -- Checked when chosen; equipment later moved or disabled keeps old records valid.
  if tg_op = 'INSERT' then
    if not private.filter_equipment_ok(new.outlet_id, new.brewer_id, new.grinder_id) then
      raise exception 'Choose a brewer and grinder of this outlet' using errcode = '23514';
    end if;
  elsif new.grinder_id <> old.grinder_id and not exists (
          select 1 from public.grinders g
           where g.id = new.grinder_id and g.outlet_id = new.outlet_id and g.is_active) then
    raise exception 'Choose a grinder of this outlet' using errcode = '23514';
  end if;
  if private.is_api_caller() then
    perform private.calibration_window_ok(new.outlet_id, new.business_date);
    if new.deleted_at is distinct from (case when tg_op = 'UPDATE' then old.deleted_at end)
       and not private.can_manage_outlet(new.outlet_id) then
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
create trigger filter_calibrations_guard before insert or update on public.filter_calibrations
  for each row execute function private.filter_calibrations_guard();

alter table public.filter_calibrations enable row level security;
create policy filter_calibrations_select on public.filter_calibrations for select to authenticated
  using (private.is_outlet_member(outlet_id)
         and (deleted_at is null or private.can_manage_outlet(outlet_id)));
create policy filter_calibrations_insert on public.filter_calibrations for insert to authenticated
  with check (private.is_outlet_member(outlet_id) and created_by = auth.uid());
create policy filter_calibrations_update on public.filter_calibrations for update to authenticated
  using (private.is_outlet_member(outlet_id)) with check (private.is_outlet_member(outlet_id));
revoke all on public.filter_calibrations from anon;
revoke delete on public.filter_calibrations from authenticated;

-- Test brews (insert only) --------------------------------------------------

create table public.filter_calibration_brews (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete restrict,
  business_date date not null default public.my_business_date(),
  coffee_bean_material_id uuid not null references public.materials (id) on delete restrict,
  brewer_id uuid not null references public.brewers (id) on delete restrict,
  grinder_id uuid not null references public.grinders (id) on delete restrict,
  grind_setting text not null check (char_length(btrim(grind_setting)) between 1 and 50),
  dose_g numeric(8, 2) not null check (dose_g > 0),
  water_g numeric(8, 1) not null check (water_g > 0),
  water_temp_c numeric(4, 1) check (water_temp_c between 70 and 100),
  bloom_water_g numeric(7, 1) check (bloom_water_g >= 0),
  bloom_seconds numeric(5, 1) check (bloom_seconds >= 0),
  pour_count integer check (pour_count between 1 and 20),
  total_time_seconds numeric(6, 1) not null check (total_time_seconds > 0),
  beverage_g numeric(8, 1) check (beverage_g > 0),
  tds_percent numeric(5, 2) check (tds_percent > 0 and tds_percent <= 25),
  taste_balance text check (taste_balance in ('SOUR', 'BALANCED', 'BITTER')),
  taste_notes text check (char_length(taste_notes) <= 1000),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index filter_calibration_brews_day_idx
  on public.filter_calibration_brews (outlet_id, business_date, coffee_bean_material_id, brewer_id, created_at);

create function private.filter_brews_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.materials
     where id = new.coffee_bean_material_id and is_coffee_bean and status = 'APPROVED') then
    raise exception 'Choose an approved coffee bean' using errcode = '23514';
  end if;
  if not private.filter_equipment_ok(new.outlet_id, new.brewer_id, new.grinder_id) then
    raise exception 'Choose a brewer and grinder of this outlet' using errcode = '23514';
  end if;
  perform private.calibration_window_ok(new.outlet_id, new.business_date);
  return new;
end;
$$;
create trigger filter_brews_guard before insert on public.filter_calibration_brews
  for each row execute function private.filter_brews_guard();

alter table public.filter_calibration_brews enable row level security;
create policy filter_brews_select on public.filter_calibration_brews for select to authenticated
  using (private.is_outlet_member(outlet_id));
create policy filter_brews_insert on public.filter_calibration_brews for insert to authenticated
  with check (private.is_outlet_member(outlet_id) and created_by = auth.uid());
revoke all on public.filter_calibration_brews from anon;
revoke update, delete on public.filter_calibration_brews from authenticated;

-- Target ranges per bean for filter (Manager or Admin) ----------------------

create table public.coffee_bean_filter_targets (
  material_id uuid primary key references public.materials (id) on delete restrict,
  dose_min_g numeric(8, 2) not null check (dose_min_g > 0),
  dose_max_g numeric(8, 2) not null,
  ratio_min numeric(5, 2) not null check (ratio_min > 0),
  ratio_max numeric(5, 2) not null,
  time_min_seconds numeric(6, 1) not null check (time_min_seconds > 0),
  time_max_seconds numeric(6, 1) not null,
  updated_by uuid default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  check (dose_min_g <= dose_max_g and ratio_min <= ratio_max and time_min_seconds <= time_max_seconds)
);
create trigger coffee_bean_filter_targets_touch before update on public.coffee_bean_filter_targets
  for each row execute function private.touch_row();
create trigger coffee_bean_filter_targets_guard before insert or update on public.coffee_bean_filter_targets
  for each row execute function private.coffee_bean_targets_guard();
create trigger audit_coffee_bean_filter_targets after insert or update or delete on public.coffee_bean_filter_targets
  for each row execute function private.audit_row();

alter table public.coffee_bean_filter_targets enable row level security;
create policy coffee_bean_filter_targets_select on public.coffee_bean_filter_targets for select to authenticated
  using (true);
create policy coffee_bean_filter_targets_insert on public.coffee_bean_filter_targets for insert to authenticated
  with check (private.is_admin() or private.is_manager());
create policy coffee_bean_filter_targets_update on public.coffee_bean_filter_targets for update to authenticated
  using (private.is_admin() or private.is_manager()) with check (private.is_admin() or private.is_manager());
revoke all on public.coffee_bean_filter_targets from anon;
revoke delete on public.coffee_bean_filter_targets from authenticated;
