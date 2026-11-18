-- Daily Coffee Calibration: espresso machines and grinders per outlet, more shot
-- parameters, target ranges per coffee bean and test shots (Nelson, 2026-11-18).
-- One final record per outlet, day, bean and grinder (was outlet, day and bean).

-- Equipment (Settings, Super Admin) ---------------------------------------

create table public.grinders (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  brand text check (char_length(brand) <= 60),
  model text check (char_length(model) <= 60),
  burr_type text check (burr_type in ('FLAT', 'CONICAL', 'OTHER')),
  burr_size_mm numeric(5, 1) check (burr_size_mm > 0),
  scale_type text not null default 'STEPPED' check (scale_type in ('STEPPED', 'STEPLESS')),
  scale_min numeric(8, 2),
  scale_max numeric(8, 2),
  serial_number text check (char_length(serial_number) <= 80),
  notes text check (char_length(notes) <= 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  check (scale_min is null or scale_max is null or scale_min < scale_max),
  unique (outlet_id, name)
);
create trigger grinders_touch before update on public.grinders
  for each row execute function private.touch_row();

create table public.espresso_machines (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  brand text check (char_length(brand) <= 60),
  model text check (char_length(model) <= 60),
  group_count integer check (group_count between 1 and 6),
  default_water_temp_c numeric(4, 1) check (default_water_temp_c between 80 and 100),
  default_pressure_bar numeric(4, 1) check (default_pressure_bar > 0 and default_pressure_bar <= 20),
  serial_number text check (char_length(serial_number) <= 80),
  notes text check (char_length(notes) <= 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  unique (outlet_id, name)
);
create trigger espresso_machines_touch before update on public.espresso_machines
  for each row execute function private.touch_row();

create trigger audit_grinders after insert or update or delete on public.grinders
  for each row execute function private.audit_row();
create trigger audit_espresso_machines after insert or update or delete on public.espresso_machines
  for each row execute function private.audit_row();

alter table public.grinders enable row level security;
alter table public.espresso_machines enable row level security;

-- Everyone signed in reads equipment; only the Super Admin changes it. No delete:
-- records keep pointing at the machine, so it is disabled instead.
create policy grinders_select on public.grinders for select to authenticated using (true);
create policy grinders_insert on public.grinders for insert to authenticated with check (private.is_admin());
create policy grinders_update on public.grinders for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
create policy espresso_machines_select on public.espresso_machines for select to authenticated using (true);
create policy espresso_machines_insert on public.espresso_machines for insert to authenticated
  with check (private.is_admin());
create policy espresso_machines_update on public.espresso_machines for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

grant select, insert, update on public.grinders, public.espresso_machines to authenticated;

-- Calibration record: equipment and more parameters ----------------------

alter table public.calibrations
  add column grinder_id uuid references public.grinders (id) on delete restrict,
  add column espresso_machine_id uuid references public.espresso_machines (id) on delete restrict,
  add column water_temp_c numeric(4, 1) check (water_temp_c between 80 and 100),
  add column pressure_bar numeric(4, 1) check (pressure_bar > 0 and pressure_bar <= 20),
  add column preinfusion_seconds numeric(5, 1) check (preinfusion_seconds >= 0),
  add column basket_g numeric(5, 1) check (basket_g > 0),
  add column tds_percent numeric(5, 2) check (tds_percent > 0 and tds_percent <= 25),
  add column roast_date date,
  add column taste_balance text check (taste_balance in ('SOUR', 'BALANCED', 'BITTER'));

-- The table had no rows when this was written; any older row has no grinder and
-- must be given one before the column can be required.
alter table public.calibrations alter column grinder_id set not null;
alter table public.calibrations
  drop constraint calibrations_outlet_id_business_date_coffee_bean_material_i_key;
alter table public.calibrations
  add constraint calibrations_outlet_day_bean_grinder_key
  unique (outlet_id, business_date, coffee_bean_material_id, grinder_id);
alter table public.calibrations
  add constraint calibrations_roast_date_check check (roast_date is null or roast_date <= business_date);

-- Grinder and machine must belong to the record's outlet and be in use when chosen.
create function private.calibration_equipment_ok(
  p_outlet_id uuid, p_grinder_id uuid, p_machine_id uuid
) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
           select 1 from public.grinders g
            where g.id = p_grinder_id and g.outlet_id = p_outlet_id and g.is_active)
     and (p_machine_id is null or exists (
           select 1 from public.espresso_machines m
            where m.id = p_machine_id and m.outlet_id = p_outlet_id and m.is_active));
$$;
grant execute on function private.calibration_equipment_ok(uuid, uuid, uuid) to authenticated;

create or replace function private.calibrations_guard() returns trigger
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
       or new.coffee_bean_material_id <> old.coffee_bean_material_id
       or new.grinder_id <> old.grinder_id then
      raise exception 'Outlet, date, bean and grinder identify the record and cannot change'
        using errcode = '23514';
    end if;
  end if;
  -- Checked when chosen; a machine later moved or disabled keeps old records valid.
  if tg_op = 'INSERT' then
    if not private.calibration_equipment_ok(new.outlet_id, new.grinder_id, new.espresso_machine_id) then
      raise exception 'Choose a grinder and machine of this outlet' using errcode = '23514';
    end if;
  elsif new.espresso_machine_id is distinct from old.espresso_machine_id
        and new.espresso_machine_id is not null
        and not exists (
          select 1 from public.espresso_machines m
           where m.id = new.espresso_machine_id and m.outlet_id = new.outlet_id and m.is_active) then
    raise exception 'Choose a machine of this outlet' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
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

-- Target ranges per coffee bean (Manager or Admin) -----------------------

create table public.coffee_bean_targets (
  material_id uuid primary key references public.materials (id) on delete restrict,
  dose_min_g numeric(8, 2) not null check (dose_min_g > 0),
  dose_max_g numeric(8, 2) not null,
  yield_min_g numeric(8, 2) not null check (yield_min_g > 0),
  yield_max_g numeric(8, 2) not null,
  time_min_seconds numeric(6, 1) not null check (time_min_seconds > 0),
  time_max_seconds numeric(6, 1) not null,
  updated_by uuid default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  check (dose_min_g <= dose_max_g and yield_min_g <= yield_max_g and time_min_seconds <= time_max_seconds)
);
create trigger coffee_bean_targets_touch before update on public.coffee_bean_targets
  for each row execute function private.touch_row();

create function private.coffee_bean_targets_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.materials where id = new.material_id and is_coffee_bean) then
    raise exception 'Targets are for coffee beans only' using errcode = '23514';
  end if;
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger coffee_bean_targets_guard before insert or update on public.coffee_bean_targets
  for each row execute function private.coffee_bean_targets_guard();
create trigger audit_coffee_bean_targets after insert or update or delete on public.coffee_bean_targets
  for each row execute function private.audit_row();

alter table public.coffee_bean_targets enable row level security;
create policy coffee_bean_targets_select on public.coffee_bean_targets for select to authenticated using (true);
create policy coffee_bean_targets_insert on public.coffee_bean_targets for insert to authenticated
  with check (private.is_admin() or private.is_manager());
create policy coffee_bean_targets_update on public.coffee_bean_targets for update to authenticated
  using (private.is_admin() or private.is_manager()) with check (private.is_admin() or private.is_manager());
grant select, insert, update on public.coffee_bean_targets to authenticated;

-- Test shots while dialling in (the final values go in calibrations) -----

create table public.calibration_shots (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete restrict,
  business_date date not null default public.my_business_date(),
  coffee_bean_material_id uuid not null references public.materials (id) on delete restrict,
  grinder_id uuid not null references public.grinders (id) on delete restrict,
  espresso_machine_id uuid references public.espresso_machines (id) on delete restrict,
  dose_g numeric(8, 2) not null check (dose_g > 0),
  yield_g numeric(8, 2) not null check (yield_g > 0),
  extraction_time_seconds numeric(6, 1) not null check (extraction_time_seconds > 0),
  grind_setting text not null check (char_length(btrim(grind_setting)) between 1 and 50),
  water_temp_c numeric(4, 1) check (water_temp_c between 80 and 100),
  pressure_bar numeric(4, 1) check (pressure_bar > 0 and pressure_bar <= 20),
  preinfusion_seconds numeric(5, 1) check (preinfusion_seconds >= 0),
  basket_g numeric(5, 1) check (basket_g > 0),
  tds_percent numeric(5, 2) check (tds_percent > 0 and tds_percent <= 25),
  taste_balance text check (taste_balance in ('SOUR', 'BALANCED', 'BITTER')),
  taste_notes text check (char_length(taste_notes) <= 1000),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index calibration_shots_day_idx
  on public.calibration_shots (outlet_id, business_date, coffee_bean_material_id, grinder_id, created_at);

-- Same date window as records; shots are never changed or deleted.
create function private.calibration_shots_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_today date := public.my_business_date();
begin
  if not exists (
    select 1 from public.materials
     where id = new.coffee_bean_material_id and is_coffee_bean and status = 'APPROVED') then
    raise exception 'Choose an approved coffee bean' using errcode = '23514';
  end if;
  if not private.calibration_equipment_ok(new.outlet_id, new.grinder_id, new.espresso_machine_id) then
    raise exception 'Choose a grinder and machine of this outlet' using errcode = '23514';
  end if;
  if private.is_api_caller() then
    if private.can_manage_outlet(new.outlet_id) then
      if new.business_date < v_today - 7 or new.business_date > v_today then
        raise exception 'Calibrations can be changed for the last 7 days only' using errcode = '42501';
      end if;
    elsif new.business_date <> v_today then
      raise exception 'Baristas can only record today''s calibration' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger calibration_shots_guard before insert on public.calibration_shots
  for each row execute function private.calibration_shots_guard();

alter table public.calibration_shots enable row level security;
create policy calibration_shots_select on public.calibration_shots for select to authenticated
  using (private.is_outlet_member(outlet_id));
create policy calibration_shots_insert on public.calibration_shots for insert to authenticated
  with check (private.is_outlet_member(outlet_id) and created_by = auth.uid());
grant select, insert on public.calibration_shots to authenticated;

revoke delete on public.grinders, public.espresso_machines, public.coffee_bean_targets from anon, authenticated;
revoke update, delete on public.calibration_shots from anon, authenticated;
