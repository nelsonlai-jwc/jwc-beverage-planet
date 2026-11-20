-- Grinder speed (Nelson, 2026-11-20): a Settings grinder can be marked "adjustable speed
-- (RPM)" with a min/max range; calibration records and test shots/brews made with that
-- grinder can then record the RPM used (optional, must be inside the range).
-- Additive only: no data is removed.

alter table public.grinders
  add column rpm_adjustable boolean not null default false,
  add column rpm_min integer,
  add column rpm_max integer,
  add constraint grinders_rpm_range check (
    (not rpm_adjustable and rpm_min is null and rpm_max is null)
    or (rpm_adjustable and rpm_min is not null and rpm_max is not null
        and rpm_min > 0 and rpm_max > rpm_min and rpm_max <= 10000)
  );

alter table public.calibrations add column grinder_rpm integer check (grinder_rpm > 0);
alter table public.calibration_shots add column grinder_rpm integer check (grinder_rpm > 0);
alter table public.filter_calibrations add column grinder_rpm integer check (grinder_rpm > 0);
alter table public.filter_calibration_brews add column grinder_rpm integer check (grinder_rpm > 0);

-- RPM only with a Settings grinder that has adjustable speed, inside its range.
-- Checked when the RPM or grinder is set or changed, so older records stay editable
-- after the grinder's range changes.
create function private.grinder_rpm_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.grinder_rpm is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.grinder_rpm is not distinct from old.grinder_rpm
     and new.grinder_id is not distinct from old.grinder_id then
    return new;
  end if;
  if not exists (
    select 1 from public.grinders g
     where g.id = new.grinder_id and g.rpm_adjustable
       and new.grinder_rpm between g.rpm_min and g.rpm_max) then
    raise exception 'Grinder RPM is outside the grinder''s range' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger grinder_rpm_guard before insert or update of grinder_rpm, grinder_id on public.calibrations
  for each row execute function private.grinder_rpm_guard();
create trigger grinder_rpm_guard before insert or update of grinder_rpm, grinder_id on public.calibration_shots
  for each row execute function private.grinder_rpm_guard();
create trigger grinder_rpm_guard before insert or update of grinder_rpm, grinder_id on public.filter_calibrations
  for each row execute function private.grinder_rpm_guard();
create trigger grinder_rpm_guard before insert or update of grinder_rpm, grinder_id on public.filter_calibration_brews
  for each row execute function private.grinder_rpm_guard();

-- Save the espresso record with its RPM (same as 20261118070000 plus grinder_rpm).
create or replace function public.save_espresso_calibration(
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
      espresso_machine_id, machine_name, grind_setting, grinder_rpm, water_temp_c, pressure_bar,
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
      (p_record->>'grinder_rpm')::integer,
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
      grinder_rpm = (p_record->>'grinder_rpm')::integer,
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
