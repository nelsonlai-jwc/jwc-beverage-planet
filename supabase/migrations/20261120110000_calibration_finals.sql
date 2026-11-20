-- Calibration redesign (Nelson, 2026-11-20).
--
-- A record is now one Final: one set of values (espresso dose / yield / time, or the filter
-- brew), ticked for the drinks it applies to:
--   Espresso: BLACK_HOT, BLACK_ICED, MILK_HOT (White hot), MILK_ICED (White iced)
--   Filter:   HOT, ICED
-- Daily rule: per outlet, day, bean, grinder and ticked item there is one current Final.
-- A new Final for the same item replaces the old one only when the person agreed to it
-- (the app warns first); the old one stays, marked as replaced.
-- Custom (personal) records: every save is its own record, no rule.
-- Records are no longer edited: a new Final replaces. Delete / restore stays.
-- Also: production number (PR-47481) on each record; test shots no longer have a drink type.
--
-- Existing calibration data was test data and is removed first (Nelson, 2026-11-20).

-- 0. Remove test data -----------------------------------------------------------

delete from public.survey_responses
 where survey_id in (select id from public.surveys where subject_type in ('ESPRESSO', 'FILTER'));
delete from public.survey_invitees
 where survey_id in (select id from public.surveys where subject_type in ('ESPRESSO', 'FILTER'));
delete from public.surveys where subject_type in ('ESPRESSO', 'FILTER');
delete from public.calibration_history;
delete from public.calibration_drinks;
delete from public.calibrations;
delete from public.calibration_shots;
delete from public.filter_calibrations;
delete from public.filter_calibration_brews;

-- 1. Espresso: values back on the record, drink rows become "applies to" ---------

drop function public.save_espresso_calibration(uuid, integer, jsonb, jsonb);

alter table public.calibrations drop constraint calibrations_outlet_day_bean_grinder_key;
alter table public.calibrations
  add column dose_g numeric(8, 2) not null check (dose_g > 0),
  add column yield_g numeric(8, 2) not null check (yield_g > 0),
  add column extraction_time_seconds numeric(6, 1) not null check (extraction_time_seconds > 0),
  add column tds_percent numeric(5, 2) check (tds_percent > 0 and tds_percent <= 25),
  add column taste_balance text check (taste_balance in ('SOUR', 'BALANCED', 'BITTER')),
  add column taste_notes text check (char_length(taste_notes) <= 1000),
  add column production_no text check (production_no ~ '^PR-[0-9]{5}$');
create index calibrations_daily_idx on public.calibrations (outlet_id, business_date) where purpose = 'DAILY';

alter table public.calibration_shots drop column drink_type;

drop policy calibration_drinks_insert on public.calibration_drinks;
drop policy calibration_drinks_delete on public.calibration_drinks;
drop trigger calibration_drinks_guard on public.calibration_drinks;
drop function private.calibration_drinks_guard();
revoke insert, update, delete on public.calibration_drinks from authenticated;

alter table public.calibration_drinks
  drop column dose_g,
  drop column yield_g,
  drop column extraction_time_seconds,
  drop column tds_percent,
  drop column taste_balance,
  drop column taste_notes,
  -- Copied from the record, for the one-current-Final rule.
  add column purpose text not null check (purpose in ('DAILY', 'CUSTOM')),
  add column outlet_id uuid references public.outlets (id) on delete restrict,
  add column business_date date not null,
  add column coffee_bean_material_id uuid not null references public.materials (id) on delete restrict,
  add column grinder_id uuid references public.grinders (id) on delete restrict,
  add column record_deleted boolean not null default false,
  add column superseded_by uuid references public.calibrations (id) on delete restrict,
  add column superseded_at timestamptz,
  add constraint calibration_drinks_superseded check ((superseded_by is null) = (superseded_at is null));
create unique index calibration_drinks_current_key
  on public.calibration_drinks (outlet_id, business_date, coffee_bean_material_id, grinder_id, drink_type)
  where purpose = 'DAILY' and superseded_by is null and not record_deleted;

-- 2. Filter: same shape ------------------------------------------------------------

alter table public.filter_calibrations drop constraint filter_calibrations_outlet_id_business_date_coffee_bean_mat_key;
alter table public.filter_calibrations
  add column production_no text check (production_no ~ '^PR-[0-9]{5}$');
create index filter_calibrations_daily_idx on public.filter_calibrations (outlet_id, business_date) where purpose = 'DAILY';

create table public.filter_calibration_uses (
  id uuid primary key default gen_random_uuid(),
  filter_calibration_id uuid not null references public.filter_calibrations (id) on delete cascade,
  temperature text not null check (temperature in ('HOT', 'ICED')),
  purpose text not null check (purpose in ('DAILY', 'CUSTOM')),
  outlet_id uuid references public.outlets (id) on delete restrict,
  business_date date not null,
  coffee_bean_material_id uuid not null references public.materials (id) on delete restrict,
  grinder_id uuid references public.grinders (id) on delete restrict,
  record_deleted boolean not null default false,
  superseded_by uuid references public.filter_calibrations (id) on delete restrict,
  superseded_at timestamptz,
  check ((superseded_by is null) = (superseded_at is null)),
  unique (filter_calibration_id, temperature)
);
create unique index filter_calibration_uses_current_key
  on public.filter_calibration_uses (outlet_id, business_date, coffee_bean_material_id, grinder_id, temperature)
  where purpose = 'DAILY' and superseded_by is null and not record_deleted;
create trigger audit_filter_calibration_uses after insert or update or delete on public.filter_calibration_uses
  for each row execute function private.audit_row();

alter table public.filter_calibration_uses enable row level security;
create policy filter_calibration_uses_select on public.filter_calibration_uses for select to authenticated
  using (exists (select 1 from public.filter_calibrations f where f.id = filter_calibration_id));
grant select on public.filter_calibration_uses to authenticated;
revoke all on public.filter_calibration_uses from anon;

-- 3. Records are not edited any more; only delete / restore ------------------------

create or replace function private.calibrations_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['deleted_at', 'deleted_by', 'delete_reason', 'updated_at', 'updated_by', 'revision'])
       <> (to_jsonb(old) - array['deleted_at', 'deleted_by', 'delete_reason', 'updated_at', 'updated_by', 'revision']) then
      raise exception 'A Final cannot be changed; record a new one' using errcode = '23514';
    end if;
    perform private.record_calibration_history(old.id, to_jsonb(old));
  else
    if not exists (
      select 1 from public.materials
       where id = new.coffee_bean_material_id and espresso_calibration and status = 'APPROVED') then
      raise exception 'Choose an approved coffee bean' using errcode = '23514';
    end if;
    if new.purpose = 'DAILY' then
      if not private.calibration_equipment_ok(new.outlet_id, new.grinder_id, new.espresso_machine_id) then
        raise exception 'Choose a grinder and machine of this outlet' using errcode = '23514';
      end if;
    elsif not private.custom_equipment_ok('grinders', new.grinder_id)
          or not private.custom_equipment_ok('espresso_machines', new.espresso_machine_id) then
      raise exception 'Choose a grinder and machine in use' using errcode = '23514';
    end if;
  end if;

  if private.is_api_caller() then
    if new.purpose = 'DAILY' then
      perform private.calibration_window_ok(new.outlet_id, new.business_date);
      if tg_op = 'UPDATE' and not private.can_manage_outlet(new.outlet_id) then
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

create or replace function private.filter_calibrations_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['deleted_at', 'deleted_by', 'delete_reason', 'updated_at', 'updated_by', 'revision'])
       <> (to_jsonb(old) - array['deleted_at', 'deleted_by', 'delete_reason', 'updated_at', 'updated_by', 'revision']) then
      raise exception 'A Final cannot be changed; record a new one' using errcode = '23514';
    end if;
  else
    if not exists (
      select 1 from public.materials
       where id = new.coffee_bean_material_id and filter_calibration and status = 'APPROVED') then
      raise exception 'Choose an approved coffee bean' using errcode = '23514';
    end if;
    if new.purpose = 'DAILY' then
      if not private.filter_equipment_ok(new.outlet_id, new.brewer_id, new.grinder_id) then
        raise exception 'Choose a brewer and grinder of this outlet' using errcode = '23514';
      end if;
    elsif not private.custom_equipment_ok('brewers', new.brewer_id)
          or not private.custom_equipment_ok('grinders', new.grinder_id) then
      raise exception 'Choose a brewer and grinder in use' using errcode = '23514';
    end if;
  end if;

  if private.is_api_caller() then
    if new.purpose = 'DAILY' then
      perform private.calibration_window_ok(new.outlet_id, new.business_date);
      if tg_op = 'UPDATE' and not private.can_manage_outlet(new.outlet_id) then
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

-- A deleted record stops counting as the current Final; restoring it fails (23505)
-- when a newer Final has taken its place.
create function private.calibration_uses_follow_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.deleted_at is null) <> (old.deleted_at is null) then
    if tg_table_name = 'calibrations' then
      update public.calibration_drinks set record_deleted = new.deleted_at is not null
       where calibration_id = new.id;
    else
      update public.filter_calibration_uses set record_deleted = new.deleted_at is not null
       where filter_calibration_id = new.id;
    end if;
  end if;
  return new;
end;
$$;
create trigger calibrations_uses_follow_delete after update of deleted_at on public.calibrations
  for each row execute function private.calibration_uses_follow_delete();
create trigger filter_calibrations_uses_follow_delete after update of deleted_at on public.filter_calibrations
  for each row execute function private.calibration_uses_follow_delete();

-- 4. Save a Final ------------------------------------------------------------------
-- p_uses: the ticked items. p_replace: ids of the current Finals' rows (calibration_drinks /
-- filter_calibration_uses) the person agreed to replace, as shown in the warning.
-- When the current Finals differ from p_replace (someone saved meanwhile) nothing is saved
-- and the error is 40001, so the app checks again and shows the new warning.

create function private.claim_calibration_uses(p_kind text, p_id uuid, p_uses text[], p_replace uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v record;
  v_current uuid[];
  v_item text;
begin
  if p_kind = 'ESPRESSO' then
    select purpose, outlet_id, business_date, coffee_bean_material_id, grinder_id, created_by, created_at
      into v from public.calibrations where id = p_id;
  else
    select purpose, outlet_id, business_date, coffee_bean_material_id, grinder_id, created_by, created_at
      into v from public.filter_calibrations where id = p_id;
  end if;
  -- Only for the record this transaction has just made.
  if v.created_by is distinct from auth.uid() or v.created_at <> now() then
    raise exception 'Not a new record of yours' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_uses), 0) = 0 then
    raise exception 'Tick at least one drink' using errcode = '23514';
  end if;

  if v.purpose = 'DAILY' then
    perform pg_advisory_xact_lock(hashtext(concat_ws('|', p_kind, v.outlet_id, v.business_date,
                                                     v.coffee_bean_material_id, v.grinder_id)));
    if p_kind = 'ESPRESSO' then
      select coalesce(array_agg(id order by id), '{}') into v_current from public.calibration_drinks
       where purpose = 'DAILY' and superseded_by is null and not record_deleted
         and outlet_id = v.outlet_id and business_date = v.business_date
         and coffee_bean_material_id = v.coffee_bean_material_id and grinder_id = v.grinder_id
         and drink_type = any (p_uses);
    else
      select coalesce(array_agg(id order by id), '{}') into v_current from public.filter_calibration_uses
       where purpose = 'DAILY' and superseded_by is null and not record_deleted
         and outlet_id = v.outlet_id and business_date = v.business_date
         and coffee_bean_material_id = v.coffee_bean_material_id and grinder_id = v.grinder_id
         and temperature = any (p_uses);
    end if;
    if not (v_current @> coalesce(p_replace, '{}') and coalesce(p_replace, '{}') @> v_current) then
      raise exception 'The current Finals changed; check again' using errcode = '40001';
    end if;
    if cardinality(v_current) > 0 then
      if p_kind = 'ESPRESSO' then
        update public.calibration_drinks set superseded_by = p_id, superseded_at = now() where id = any (v_current);
      else
        update public.filter_calibration_uses set superseded_by = p_id, superseded_at = now() where id = any (v_current);
      end if;
    end if;
  end if;

  foreach v_item in array p_uses loop
    if p_kind = 'ESPRESSO' then
      insert into public.calibration_drinks
        (calibration_id, drink_type, purpose, outlet_id, business_date, coffee_bean_material_id, grinder_id)
      values (p_id, v_item, v.purpose, v.outlet_id, v.business_date, v.coffee_bean_material_id, v.grinder_id);
    else
      insert into public.filter_calibration_uses
        (filter_calibration_id, temperature, purpose, outlet_id, business_date, coffee_bean_material_id, grinder_id)
      values (p_id, v_item, v.purpose, v.outlet_id, v.business_date, v.coffee_bean_material_id, v.grinder_id);
    end if;
  end loop;
end;
$$;
revoke all on function private.claim_calibration_uses(text, uuid, text[], uuid[]) from public, anon;
grant execute on function private.claim_calibration_uses(text, uuid, text[], uuid[]) to authenticated;

create function public.save_espresso_calibration(p_record jsonb, p_uses text[], p_replace uuid[])
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.calibrations (
    purpose, outlet_id, business_date, coffee_bean_material_id, grinder_id, grinder_name,
    espresso_machine_id, machine_name, grind_setting, grinder_rpm, water_temp_c, pressure_bar,
    preinfusion_seconds, basket_g, roast_date, production_no,
    dose_g, yield_g, extraction_time_seconds, tds_percent, taste_balance, taste_notes)
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
    (p_record->>'grinder_rpm')::integer,
    (p_record->>'water_temp_c')::numeric,
    (p_record->>'pressure_bar')::numeric,
    (p_record->>'preinfusion_seconds')::numeric,
    (p_record->>'basket_g')::numeric,
    (p_record->>'roast_date')::date,
    nullif(btrim(p_record->>'production_no'), ''),
    (p_record->>'dose_g')::numeric,
    (p_record->>'yield_g')::numeric,
    (p_record->>'extraction_time_seconds')::numeric,
    (p_record->>'tds_percent')::numeric,
    p_record->>'taste_balance',
    nullif(btrim(p_record->>'taste_notes'), ''))
  returning id into v_id;
  if exists (select unnest(p_uses) except select unnest(array['BLACK_HOT', 'BLACK_ICED', 'MILK_HOT', 'MILK_ICED'])) then
    raise exception 'Unknown drink' using errcode = '23514';
  end if;
  perform private.claim_calibration_uses('ESPRESSO', v_id, p_uses, p_replace);
  return v_id;
end;
$$;
revoke all on function public.save_espresso_calibration(jsonb, text[], uuid[]) from public, anon;
grant execute on function public.save_espresso_calibration(jsonb, text[], uuid[]) to authenticated;

create function public.save_filter_calibration(p_record jsonb, p_uses text[], p_replace uuid[])
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.filter_calibrations (
    purpose, outlet_id, business_date, coffee_bean_material_id, brewer_id, brewer_name,
    grinder_id, grinder_name, grind_setting, grinder_rpm, dose_g, water_g, water_temp_c,
    bloom_water_g, bloom_seconds, pour_count, total_time_seconds, beverage_g, tds_percent,
    roast_date, production_no, taste_balance, taste_notes)
  values (
    coalesce(p_record->>'purpose', 'DAILY'),
    (p_record->>'outlet_id')::uuid,
    coalesce((p_record->>'business_date')::date, public.my_business_date()),
    (p_record->>'coffee_bean_material_id')::uuid,
    (p_record->>'brewer_id')::uuid,
    p_record->>'brewer_name',
    (p_record->>'grinder_id')::uuid,
    p_record->>'grinder_name',
    p_record->>'grind_setting',
    (p_record->>'grinder_rpm')::integer,
    (p_record->>'dose_g')::numeric,
    (p_record->>'water_g')::numeric,
    (p_record->>'water_temp_c')::numeric,
    (p_record->>'bloom_water_g')::numeric,
    (p_record->>'bloom_seconds')::numeric,
    (p_record->>'pour_count')::integer,
    (p_record->>'total_time_seconds')::numeric,
    (p_record->>'beverage_g')::numeric,
    (p_record->>'tds_percent')::numeric,
    (p_record->>'roast_date')::date,
    nullif(btrim(p_record->>'production_no'), ''),
    p_record->>'taste_balance',
    nullif(btrim(p_record->>'taste_notes'), ''))
  returning id into v_id;
  if exists (select unnest(p_uses) except select unnest(array['HOT', 'ICED'])) then
    raise exception 'Unknown temperature' using errcode = '23514';
  end if;
  perform private.claim_calibration_uses('FILTER', v_id, p_uses, p_replace);
  return v_id;
end;
$$;
revoke all on function public.save_filter_calibration(jsonb, text[], uuid[]) from public, anon;
grant execute on function public.save_filter_calibration(jsonb, text[], uuid[]) to authenticated;
