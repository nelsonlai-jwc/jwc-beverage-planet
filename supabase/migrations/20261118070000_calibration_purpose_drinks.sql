-- Daily / Custom calibrations and espresso values per drink type (Nelson, 2026-11-18).
--
-- DAILY: the outlet's record, as before (one per outlet, day, bean and grinder or brewer).
-- CUSTOM: a personal record with no outlet. Only its creator and the Super Admin see it,
--   only its creator changes it, any date, any number per day. Equipment is any grinder,
--   machine or brewer from Settings, or a name typed in.
-- Espresso: grinder, grind and machine settings stay on the record; dose, yield, time,
--   TDS and taste move to one row per drink type (black hot/iced, milk hot/iced).
--   Existing values become the "black hot" row. Targets are per bean and drink type.

-- 1. Purpose and typed-in equipment -----------------------------------------

alter table public.calibrations
  add column purpose text not null default 'DAILY' check (purpose in ('DAILY', 'CUSTOM')),
  add column grinder_name text check (char_length(btrim(grinder_name)) between 1 and 60),
  add column machine_name text check (char_length(btrim(machine_name)) between 1 and 60),
  alter column outlet_id drop not null,
  alter column grinder_id drop not null;
alter table public.calibrations add constraint calibrations_purpose_shape check (
  case purpose
    when 'DAILY' then outlet_id is not null and grinder_id is not null
                      and grinder_name is null and machine_name is null
    else outlet_id is null and (grinder_id is null) <> (grinder_name is null)
         and not (espresso_machine_id is not null and machine_name is not null)
  end);

alter table public.calibration_shots
  add column purpose text not null default 'DAILY' check (purpose in ('DAILY', 'CUSTOM')),
  add column grinder_name text check (char_length(btrim(grinder_name)) between 1 and 60),
  add column machine_name text check (char_length(btrim(machine_name)) between 1 and 60),
  add column drink_type text not null default 'BLACK_HOT'
    check (drink_type in ('BLACK_HOT', 'BLACK_ICED', 'MILK_HOT', 'MILK_ICED')),
  alter column outlet_id drop not null,
  alter column grinder_id drop not null;
alter table public.calibration_shots alter column drink_type drop default;
alter table public.calibration_shots add constraint calibration_shots_purpose_shape check (
  case purpose
    when 'DAILY' then outlet_id is not null and grinder_id is not null
                      and grinder_name is null and machine_name is null
    else outlet_id is null and (grinder_id is null) <> (grinder_name is null)
         and not (espresso_machine_id is not null and machine_name is not null)
  end);
create index calibration_shots_custom_idx
  on public.calibration_shots (created_by, business_date) where purpose = 'CUSTOM';

alter table public.filter_calibrations
  add column purpose text not null default 'DAILY' check (purpose in ('DAILY', 'CUSTOM')),
  add column brewer_name text check (char_length(btrim(brewer_name)) between 1 and 60),
  add column grinder_name text check (char_length(btrim(grinder_name)) between 1 and 60),
  alter column outlet_id drop not null,
  alter column brewer_id drop not null,
  alter column grinder_id drop not null;
alter table public.filter_calibrations add constraint filter_calibrations_purpose_shape check (
  case purpose
    when 'DAILY' then outlet_id is not null and brewer_id is not null and grinder_id is not null
                      and brewer_name is null and grinder_name is null
    else outlet_id is null and (brewer_id is null) <> (brewer_name is null)
         and (grinder_id is null) <> (grinder_name is null)
  end);

alter table public.filter_calibration_brews
  add column purpose text not null default 'DAILY' check (purpose in ('DAILY', 'CUSTOM')),
  add column brewer_name text check (char_length(btrim(brewer_name)) between 1 and 60),
  add column grinder_name text check (char_length(btrim(grinder_name)) between 1 and 60),
  alter column outlet_id drop not null,
  alter column brewer_id drop not null,
  alter column grinder_id drop not null;
alter table public.filter_calibration_brews add constraint filter_calibration_brews_purpose_shape check (
  case purpose
    when 'DAILY' then outlet_id is not null and brewer_id is not null and grinder_id is not null
                      and brewer_name is null and grinder_name is null
    else outlet_id is null and (brewer_id is null) <> (brewer_name is null)
         and (grinder_id is null) <> (grinder_name is null)
  end);
create index filter_calibration_brews_custom_idx
  on public.filter_calibration_brews (created_by, business_date) where purpose = 'CUSTOM';
create index calibrations_custom_idx on public.calibrations (created_by, business_date) where purpose = 'CUSTOM';
create index filter_calibrations_custom_idx
  on public.filter_calibrations (created_by, business_date) where purpose = 'CUSTOM';

-- 2. Espresso values per drink type ------------------------------------------

create table public.calibration_drinks (
  id uuid primary key default gen_random_uuid(),
  calibration_id uuid not null references public.calibrations (id) on delete cascade,
  drink_type text not null check (drink_type in ('BLACK_HOT', 'BLACK_ICED', 'MILK_HOT', 'MILK_ICED')),
  dose_g numeric(8, 2) not null check (dose_g > 0),
  yield_g numeric(8, 2) not null check (yield_g > 0),
  extraction_time_seconds numeric(6, 1) not null check (extraction_time_seconds > 0),
  tds_percent numeric(5, 2) check (tds_percent > 0 and tds_percent <= 25),
  taste_balance text check (taste_balance in ('SOUR', 'BALANCED', 'BITTER')),
  taste_notes text check (char_length(taste_notes) <= 1000),
  unique (calibration_id, drink_type)
);

insert into public.calibration_drinks
  (calibration_id, drink_type, dose_g, yield_g, extraction_time_seconds, tds_percent, taste_balance, taste_notes)
select id, 'BLACK_HOT', dose_g, yield_g, extraction_time_seconds, tds_percent, taste_balance, taste_notes
  from public.calibrations;

alter table public.calibrations
  drop column dose_g,
  drop column yield_g,
  drop column extraction_time_seconds,
  drop column tds_percent,
  drop column taste_balance,
  drop column taste_notes;

-- Targets: one set per bean and drink type; existing ones become "black hot".
alter table public.coffee_bean_targets
  add column drink_type text not null default 'BLACK_HOT'
    check (drink_type in ('BLACK_HOT', 'BLACK_ICED', 'MILK_HOT', 'MILK_ICED'));
alter table public.coffee_bean_targets alter column drink_type drop default;
alter table public.coffee_bean_targets drop constraint coffee_bean_targets_pkey;
alter table public.coffee_bean_targets add primary key (material_id, drink_type);

-- 3. Guards -------------------------------------------------------------------

-- Equipment of a custom record: a Settings item still in use when chosen, any outlet.
create function private.custom_equipment_ok(p_table text, p_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ok boolean;
begin
  if p_id is null then
    return true;
  end if;
  execute format('select exists (select 1 from public.%I where id = $1 and is_active)', p_table)
     into v_ok using p_id;
  return v_ok;
end;
$$;
grant execute on function private.custom_equipment_ok(text, uuid) to authenticated;

create or replace function private.calibrations_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.materials
     where id = new.coffee_bean_material_id and is_coffee_bean and status = 'APPROVED') then
    raise exception 'Choose an approved coffee bean' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.purpose <> old.purpose then
    raise exception 'Daily or custom cannot change' using errcode = '23514';
  end if;

  if new.purpose = 'DAILY' then
    if tg_op = 'UPDATE' and (
         new.outlet_id <> old.outlet_id or new.business_date <> old.business_date
         or new.coffee_bean_material_id <> old.coffee_bean_material_id or new.grinder_id <> old.grinder_id) then
      raise exception 'Outlet, date, bean and grinder identify the record and cannot change'
        using errcode = '23514';
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
  else
    if (tg_op = 'INSERT' or new.grinder_id is distinct from old.grinder_id)
       and not private.custom_equipment_ok('grinders', new.grinder_id) then
      raise exception 'Choose a grinder in use' using errcode = '23514';
    end if;
    if (tg_op = 'INSERT' or new.espresso_machine_id is distinct from old.espresso_machine_id)
       and not private.custom_equipment_ok('espresso_machines', new.espresso_machine_id) then
      raise exception 'Choose a machine in use' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- The drink rows are replaced after this update, so the history keeps the old ones.
    perform private.record_calibration_history(old.id, to_jsonb(old) || jsonb_build_object(
      'drinks', (select coalesce(jsonb_agg(to_jsonb(d) - 'id' - 'calibration_id'), '[]'::jsonb)
                   from public.calibration_drinks d where d.calibration_id = old.id)));
  end if;

  if private.is_api_caller() then
    if new.purpose = 'DAILY' then
      perform private.calibration_window_ok(new.outlet_id, new.business_date);
      if new.deleted_at is distinct from (case when tg_op = 'UPDATE' then old.deleted_at end)
         and not private.can_manage_outlet(new.outlet_id) then
        raise exception 'Only a Manager or Admin can delete or restore calibrations' using errcode = '42501';
      end if;
    end if;
    if new.deleted_at is not null and (tg_op = 'INSERT' or old.deleted_at is null) then
      new.deleted_by := auth.uid();
    end if;
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function private.calibration_shots_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.materials
     where id = new.coffee_bean_material_id and is_coffee_bean and status = 'APPROVED') then
    raise exception 'Choose an approved coffee bean' using errcode = '23514';
  end if;
  if new.purpose = 'DAILY' then
    if not private.calibration_equipment_ok(new.outlet_id, new.grinder_id, new.espresso_machine_id) then
      raise exception 'Choose a grinder and machine of this outlet' using errcode = '23514';
    end if;
    perform private.calibration_window_ok(new.outlet_id, new.business_date);
  elsif not private.custom_equipment_ok('grinders', new.grinder_id)
        or not private.custom_equipment_ok('espresso_machines', new.espresso_machine_id) then
    raise exception 'Choose a grinder and machine in use' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.filter_calibrations_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.materials
     where id = new.coffee_bean_material_id and is_coffee_bean and status = 'APPROVED') then
    raise exception 'Choose an approved coffee bean' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.purpose <> old.purpose then
    raise exception 'Daily or custom cannot change' using errcode = '23514';
  end if;

  if new.purpose = 'DAILY' then
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
  else
    if (tg_op = 'INSERT' or new.brewer_id is distinct from old.brewer_id)
       and not private.custom_equipment_ok('brewers', new.brewer_id) then
      raise exception 'Choose a brewer in use' using errcode = '23514';
    end if;
    if (tg_op = 'INSERT' or new.grinder_id is distinct from old.grinder_id)
       and not private.custom_equipment_ok('grinders', new.grinder_id) then
      raise exception 'Choose a grinder in use' using errcode = '23514';
    end if;
  end if;

  if private.is_api_caller() then
    if new.purpose = 'DAILY' then
      perform private.calibration_window_ok(new.outlet_id, new.business_date);
      if new.deleted_at is distinct from (case when tg_op = 'UPDATE' then old.deleted_at end)
         and not private.can_manage_outlet(new.outlet_id) then
        raise exception 'Only a Manager or Admin can delete or restore calibrations' using errcode = '42501';
      end if;
    end if;
    if new.deleted_at is not null and (tg_op = 'INSERT' or old.deleted_at is null) then
      new.deleted_by := auth.uid();
    end if;
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function private.filter_brews_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.materials
     where id = new.coffee_bean_material_id and is_coffee_bean and status = 'APPROVED') then
    raise exception 'Choose an approved coffee bean' using errcode = '23514';
  end if;
  if new.purpose = 'DAILY' then
    if not private.filter_equipment_ok(new.outlet_id, new.brewer_id, new.grinder_id) then
      raise exception 'Choose a brewer and grinder of this outlet' using errcode = '23514';
    end if;
    perform private.calibration_window_ok(new.outlet_id, new.business_date);
  elsif not private.custom_equipment_ok('brewers', new.brewer_id)
        or not private.custom_equipment_ok('grinders', new.grinder_id) then
    raise exception 'Choose a brewer and grinder in use' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Drink rows follow their record: same date window, not on a deleted record.
create function private.calibration_drinks_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_record public.calibrations;
begin
  select * into v_record from public.calibrations
   where id = case when tg_op = 'DELETE' then old.calibration_id else new.calibration_id end;
  if private.is_api_caller() then
    if v_record.deleted_at is not null then
      raise exception 'This record is deleted' using errcode = '42501';
    end if;
    if v_record.purpose = 'DAILY' then
      perform private.calibration_window_ok(v_record.outlet_id, v_record.business_date);
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger calibration_drinks_guard before insert or update or delete on public.calibration_drinks
  for each row execute function private.calibration_drinks_guard();
create trigger audit_calibration_drinks after insert or update or delete on public.calibration_drinks
  for each row execute function private.audit_row();

-- 4. Access -------------------------------------------------------------------

drop policy calibrations_select on public.calibrations;
drop policy calibrations_insert on public.calibrations;
drop policy calibrations_update on public.calibrations;
create policy calibrations_select on public.calibrations for select to authenticated
  using (case purpose
           when 'DAILY' then private.is_outlet_member(outlet_id)
                             and (deleted_at is null or private.can_manage_outlet(outlet_id))
           else created_by = auth.uid() or private.is_admin()
         end);
create policy calibrations_insert on public.calibrations for insert to authenticated
  with check (created_by = auth.uid()
              and (purpose = 'CUSTOM' or private.is_outlet_member(outlet_id)));
create policy calibrations_update on public.calibrations for update to authenticated
  using (case purpose when 'DAILY' then private.is_outlet_member(outlet_id) else created_by = auth.uid() end)
  with check (case purpose when 'DAILY' then private.is_outlet_member(outlet_id) else created_by = auth.uid() end);

drop policy calibration_shots_select on public.calibration_shots;
drop policy calibration_shots_insert on public.calibration_shots;
create policy calibration_shots_select on public.calibration_shots for select to authenticated
  using (case purpose when 'DAILY' then private.is_outlet_member(outlet_id)
                      else created_by = auth.uid() or private.is_admin() end);
create policy calibration_shots_insert on public.calibration_shots for insert to authenticated
  with check (created_by = auth.uid() and (purpose = 'CUSTOM' or private.is_outlet_member(outlet_id)));

drop policy filter_calibrations_select on public.filter_calibrations;
drop policy filter_calibrations_insert on public.filter_calibrations;
drop policy filter_calibrations_update on public.filter_calibrations;
create policy filter_calibrations_select on public.filter_calibrations for select to authenticated
  using (case purpose
           when 'DAILY' then private.is_outlet_member(outlet_id)
                             and (deleted_at is null or private.can_manage_outlet(outlet_id))
           else created_by = auth.uid() or private.is_admin()
         end);
create policy filter_calibrations_insert on public.filter_calibrations for insert to authenticated
  with check (created_by = auth.uid()
              and (purpose = 'CUSTOM' or private.is_outlet_member(outlet_id)));
create policy filter_calibrations_update on public.filter_calibrations for update to authenticated
  using (case purpose when 'DAILY' then private.is_outlet_member(outlet_id) else created_by = auth.uid() end)
  with check (case purpose when 'DAILY' then private.is_outlet_member(outlet_id) else created_by = auth.uid() end);

drop policy filter_brews_select on public.filter_calibration_brews;
drop policy filter_brews_insert on public.filter_calibration_brews;
create policy filter_brews_select on public.filter_calibration_brews for select to authenticated
  using (case purpose when 'DAILY' then private.is_outlet_member(outlet_id)
                      else created_by = auth.uid() or private.is_admin() end);
create policy filter_brews_insert on public.filter_calibration_brews for insert to authenticated
  with check (created_by = auth.uid() and (purpose = 'CUSTOM' or private.is_outlet_member(outlet_id)));

alter table public.calibration_drinks enable row level security;
-- Reading follows the record; writing needs the right to change the record.
create policy calibration_drinks_select on public.calibration_drinks for select to authenticated
  using (exists (select 1 from public.calibrations c where c.id = calibration_id));
create policy calibration_drinks_insert on public.calibration_drinks for insert to authenticated
  with check (exists (
    select 1 from public.calibrations c
     where c.id = calibration_id
       and case c.purpose when 'DAILY' then private.is_outlet_member(c.outlet_id)
                          else c.created_by = auth.uid() end));
create policy calibration_drinks_delete on public.calibration_drinks for delete to authenticated
  using (exists (
    select 1 from public.calibrations c
     where c.id = calibration_id
       and case c.purpose when 'DAILY' then private.is_outlet_member(c.outlet_id)
                          else c.created_by = auth.uid() end));
grant select, insert, delete on public.calibration_drinks to authenticated;
revoke all on public.calibration_drinks from anon;

-- 5. Save a record and its drink rows together ---------------------------------
-- p_id null inserts; otherwise updates when p_revision still matches (40001 if not).
-- Errors from the guards and constraints pass through (23505 already recorded).

create function public.save_espresso_calibration(
  p_id uuid, p_revision integer, p_record jsonb, p_drinks jsonb
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  if jsonb_typeof(p_drinks) is distinct from 'array' or jsonb_array_length(p_drinks) = 0 then
    raise exception 'Fill in at least one drink' using errcode = '23514';
  end if;

  if p_id is null then
    insert into public.calibrations (
      purpose, outlet_id, business_date, coffee_bean_material_id, grinder_id, grinder_name,
      espresso_machine_id, machine_name, grind_setting, water_temp_c, pressure_bar,
      preinfusion_seconds, basket_g, roast_date)
    values (
      coalesce(p_record->>'purpose', 'DAILY'),
      (p_record->>'outlet_id')::uuid,
      coalesce((p_record->>'business_date')::date, public.my_business_date()),
      (p_record->>'coffee_bean_material_id')::uuid,
      (p_record->>'grinder_id')::uuid,
      p_record->>'grinder_name',
      (p_record->>'espresso_machine_id')::uuid,
      p_record->>'machine_name',
      p_record->>'grind_setting',
      (p_record->>'water_temp_c')::numeric,
      (p_record->>'pressure_bar')::numeric,
      (p_record->>'preinfusion_seconds')::numeric,
      (p_record->>'basket_g')::numeric,
      (p_record->>'roast_date')::date)
    returning id into v_id;
  else
    update public.calibrations set
      business_date = coalesce((p_record->>'business_date')::date, business_date),
      coffee_bean_material_id = (p_record->>'coffee_bean_material_id')::uuid,
      grinder_id = (p_record->>'grinder_id')::uuid,
      grinder_name = p_record->>'grinder_name',
      espresso_machine_id = (p_record->>'espresso_machine_id')::uuid,
      machine_name = p_record->>'machine_name',
      grind_setting = p_record->>'grind_setting',
      water_temp_c = (p_record->>'water_temp_c')::numeric,
      pressure_bar = (p_record->>'pressure_bar')::numeric,
      preinfusion_seconds = (p_record->>'preinfusion_seconds')::numeric,
      basket_g = (p_record->>'basket_g')::numeric,
      roast_date = (p_record->>'roast_date')::date
     where id = p_id and revision = p_revision and deleted_at is null
    returning id into v_id;
    if v_id is null then
      raise exception 'Someone else changed this record' using errcode = '40001';
    end if;
    delete from public.calibration_drinks where calibration_id = v_id;
  end if;

  insert into public.calibration_drinks
    (calibration_id, drink_type, dose_g, yield_g, extraction_time_seconds, tds_percent, taste_balance, taste_notes)
  select v_id, d.drink_type, d.dose_g, d.yield_g, d.extraction_time_seconds, d.tds_percent,
         d.taste_balance, nullif(btrim(d.taste_notes), '')
    from jsonb_to_recordset(p_drinks) as d(
      drink_type text, dose_g numeric, yield_g numeric, extraction_time_seconds numeric,
      tds_percent numeric, taste_balance text, taste_notes text);
  return v_id;
end;
$$;
revoke all on function public.save_espresso_calibration(uuid, integer, jsonb, jsonb) from public, anon;
grant execute on function public.save_espresso_calibration(uuid, integer, jsonb, jsonb) to authenticated;
