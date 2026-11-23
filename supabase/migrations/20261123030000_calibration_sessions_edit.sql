-- Calibration sessions and editing (2026-11-23).
-- One "Set as Final" saves one Final per filled drink tab. Those Finals now share a session_id,
-- so the list shows them as one card with the drink tabs, and the session can be edited:
--   * Daily: by its creator, or a Manager / Admin of the outlet, or the Super Admin; today only.
--   * Custom: by its creator or the Super Admin; any time.
-- Bean, grinder, outlet, date and purpose stay fixed; the other values can change. Empty drink
-- tabs can be filled while editing (they join the session as new Finals, with the usual
-- replace warning). Every change keeps the old values (calibration_history / audit log).
-- Only adds a column and replaces functions / policies; no data is removed.

-- 1. Session of each Final -------------------------------------------------------

alter table public.calibrations add column session_id uuid;
alter table public.filter_calibrations add column session_id uuid;

-- Finals saved together (same person, same moment, same bean and grinder) form one session.
alter table public.calibrations disable trigger user;
update public.calibrations c set session_id = s.first
  from (select id, first_value(id) over (
                 partition by created_by, created_at, purpose, outlet_id, business_date,
                              coffee_bean_material_id, grinder_id, grinder_name
                 order by id) as first
          from public.calibrations) s
 where s.id = c.id;
alter table public.calibrations enable trigger user;

alter table public.filter_calibrations disable trigger user;
update public.filter_calibrations c set session_id = s.first
  from (select id, first_value(id) over (
                 partition by created_by, created_at, purpose, outlet_id, business_date,
                              coffee_bean_material_id, grinder_id, grinder_name
                 order by id) as first
          from public.filter_calibrations) s
 where s.id = c.id;
alter table public.filter_calibrations enable trigger user;

alter table public.calibrations alter column session_id set default gen_random_uuid(), alter column session_id set not null;
alter table public.filter_calibrations alter column session_id set default gen_random_uuid(), alter column session_id set not null;
create index calibrations_session_idx on public.calibrations (session_id);
create index filter_calibrations_session_idx on public.filter_calibrations (session_id);

-- 2. Who may edit a session -----------------------------------------------------------

-- The session's first Final decides: its creator, purpose, outlet and date.
create function private.can_edit_calibration(p_kind text, p_session uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v record;
begin
  if p_kind = 'ESPRESSO' then
    select purpose, outlet_id, business_date, created_by into v
      from public.calibrations where session_id = p_session order by created_at, id limit 1;
  else
    select purpose, outlet_id, business_date, created_by into v
      from public.filter_calibrations where session_id = p_session order by created_at, id limit 1;
  end if;
  if not found then
    return false;
  end if;
  if v.purpose = 'DAILY' then
    return v.business_date = public.my_business_date()
       and (v.created_by = auth.uid() or private.can_manage_outlet(v.outlet_id));
  end if;
  return v.created_by = auth.uid() or private.is_admin();
end;
$$;
revoke all on function private.can_edit_calibration(text, uuid) from public, anon;
grant execute on function private.can_edit_calibration(text, uuid) to authenticated;

-- A new Final may join an existing session only with the same key and with edit rights.
create function private.session_join_ok(p_kind text, p_session uuid, p_purpose text, p_outlet uuid,
                                        p_date date, p_bean uuid, p_grinder uuid, p_grinder_name text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v record;
begin
  if p_kind = 'ESPRESSO' then
    select purpose, outlet_id, business_date, coffee_bean_material_id, grinder_id, grinder_name into v
      from public.calibrations where session_id = p_session order by created_at, id limit 1;
  else
    select purpose, outlet_id, business_date, coffee_bean_material_id, grinder_id, grinder_name into v
      from public.filter_calibrations where session_id = p_session order by created_at, id limit 1;
  end if;
  if not found then
    return true; -- a new session
  end if;
  return v.purpose = p_purpose
     and v.outlet_id is not distinct from p_outlet
     and v.business_date = p_date
     and v.coffee_bean_material_id = p_bean
     and v.grinder_id is not distinct from p_grinder
     and v.grinder_name is not distinct from p_grinder_name
     and private.can_edit_calibration(p_kind, p_session);
end;
$$;
revoke all on function private.session_join_ok(text, uuid, text, uuid, date, uuid, uuid, text) from public, anon;
grant execute on function private.session_join_ok(text, uuid, text, uuid, date, uuid, uuid, text) to authenticated;

-- 3. Guards: values may change, the key may not ---------------------------------------

create or replace function private.calibrations_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_meta text[] := array['deleted_at', 'deleted_by', 'delete_reason', 'updated_at', 'updated_by', 'revision'];
  v_values text[] := array['espresso_machine_id', 'machine_name', 'grind_setting', 'grinder_rpm', 'water_temp_c',
                           'pressure_bar', 'preinfusion_seconds', 'basket_g', 'roast_date', 'production_no',
                           'dose_g', 'yield_g', 'extraction_time_seconds', 'tds_percent', 'taste_balance', 'taste_notes'];
  v_edited boolean := false;
  v_deleting boolean := false;
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - v_meta - v_values) <> (to_jsonb(old) - v_meta - v_values) then
      raise exception 'The bean, grinder, outlet and date of a Final cannot be changed' using errcode = '23514';
    end if;
    v_edited := (to_jsonb(new) - v_meta) <> (to_jsonb(old) - v_meta);
    v_deleting := new.deleted_at is distinct from old.deleted_at or new.delete_reason is distinct from old.delete_reason;
    if v_edited then
      if old.deleted_at is not null or new.deleted_at is not null then
        raise exception 'A deleted Final cannot be edited' using errcode = '23514';
      end if;
      if new.espresso_machine_id is distinct from old.espresso_machine_id and new.espresso_machine_id is not null then
        if (new.purpose = 'DAILY' and not private.outlet_machine_ok(new.outlet_id, new.espresso_machine_id))
           or (new.purpose <> 'DAILY' and not private.custom_equipment_ok('espresso_machines', new.espresso_machine_id)) then
          raise exception 'Choose a machine in use' using errcode = '23514';
        end if;
      end if;
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
    if not private.session_join_ok('ESPRESSO', new.session_id, new.purpose, new.outlet_id, new.business_date,
                                   new.coffee_bean_material_id, new.grinder_id, new.grinder_name) then
      raise exception 'You cannot add to this calibration' using errcode = '42501';
    end if;
  end if;

  if private.is_api_caller() then
    if new.purpose = 'DAILY' then
      perform private.calibration_window_ok(new.outlet_id, new.business_date);
      if v_deleting and not private.can_manage_outlet(new.outlet_id) then
        raise exception 'Only a Manager or Admin can delete or restore calibrations' using errcode = '42501';
      end if;
    elsif v_deleting and old.created_by is distinct from auth.uid() then
      raise exception 'Only the creator can delete or restore a custom calibration' using errcode = '42501';
    end if;
    if v_edited and not private.can_edit_calibration('ESPRESSO', new.session_id) then
      raise exception 'You cannot edit this calibration' using errcode = '42501';
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
declare
  v_meta text[] := array['deleted_at', 'deleted_by', 'delete_reason', 'updated_at', 'updated_by', 'revision'];
  v_values text[] := array['brewer_id', 'brewer_name', 'grind_setting', 'grinder_rpm', 'dose_g', 'water_g', 'water_temp_c',
                           'bloom_water_g', 'bloom_seconds', 'pour_count', 'total_time_seconds', 'beverage_g',
                           'tds_percent', 'roast_date', 'production_no', 'taste_balance', 'taste_notes'];
  v_edited boolean := false;
  v_deleting boolean := false;
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - v_meta - v_values) <> (to_jsonb(old) - v_meta - v_values) then
      raise exception 'The bean, grinder, outlet and date of a Final cannot be changed' using errcode = '23514';
    end if;
    v_edited := (to_jsonb(new) - v_meta) <> (to_jsonb(old) - v_meta);
    v_deleting := new.deleted_at is distinct from old.deleted_at or new.delete_reason is distinct from old.delete_reason;
    if v_edited then
      if old.deleted_at is not null or new.deleted_at is not null then
        raise exception 'A deleted Final cannot be edited' using errcode = '23514';
      end if;
      if new.brewer_id is distinct from old.brewer_id and new.brewer_id is not null then
        if (new.purpose = 'DAILY' and not private.outlet_brewer_ok(new.outlet_id, new.brewer_id))
           or (new.purpose <> 'DAILY' and not private.custom_equipment_ok('brewers', new.brewer_id)) then
          raise exception 'Choose a brewer in use' using errcode = '23514';
        end if;
      end if;
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
    if not private.session_join_ok('FILTER', new.session_id, new.purpose, new.outlet_id, new.business_date,
                                   new.coffee_bean_material_id, new.grinder_id, new.grinder_name) then
      raise exception 'You cannot add to this calibration' using errcode = '42501';
    end if;
  end if;

  if private.is_api_caller() then
    if new.purpose = 'DAILY' then
      perform private.calibration_window_ok(new.outlet_id, new.business_date);
      if v_deleting and not private.can_manage_outlet(new.outlet_id) then
        raise exception 'Only a Manager or Admin can delete or restore calibrations' using errcode = '42501';
      end if;
    elsif v_deleting and old.created_by is distinct from auth.uid() then
      raise exception 'Only the creator can delete or restore a custom calibration' using errcode = '42501';
    end if;
    if v_edited and not private.can_edit_calibration('FILTER', new.session_id) then
      raise exception 'You cannot edit this calibration' using errcode = '42501';
    end if;
    if new.deleted_at is not null and (tg_op = 'INSERT' or old.deleted_at is null) then
      new.deleted_by := auth.uid();
    end if;
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

-- The Super Admin may edit someone's custom calibration (the guard still allows only the
-- creator to delete or restore it).
drop policy calibrations_update on public.calibrations;
create policy calibrations_update on public.calibrations for update to authenticated
  using (case purpose when 'DAILY' then private.is_outlet_member(outlet_id) else created_by = auth.uid() or private.is_admin() end)
  with check (case purpose when 'DAILY' then private.is_outlet_member(outlet_id) else created_by = auth.uid() or private.is_admin() end);
drop policy filter_calibrations_update on public.filter_calibrations;
create policy filter_calibrations_update on public.filter_calibrations for update to authenticated
  using (case purpose when 'DAILY' then private.is_outlet_member(outlet_id) else created_by = auth.uid() or private.is_admin() end)
  with check (case purpose when 'DAILY' then private.is_outlet_member(outlet_id) else created_by = auth.uid() or private.is_admin() end);

-- 4. Saving: the Finals of one save share a session -------------------------------------

create or replace function public.save_espresso_calibration(p_record jsonb, p_uses text[], p_replace uuid[])
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.calibrations (
    session_id, purpose, outlet_id, business_date, coffee_bean_material_id, grinder_id, grinder_name,
    espresso_machine_id, machine_name, grind_setting, grinder_rpm, water_temp_c, pressure_bar,
    preinfusion_seconds, basket_g, roast_date, production_no,
    dose_g, yield_g, extraction_time_seconds, tds_percent, taste_balance, taste_notes)
  values (
    coalesce((p_record->>'session_id')::uuid, gen_random_uuid()),
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

create or replace function public.save_filter_calibration(p_record jsonb, p_uses text[], p_replace uuid[])
returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.filter_calibrations (
    session_id, purpose, outlet_id, business_date, coffee_bean_material_id, brewer_id, brewer_name,
    grinder_id, grinder_name, grind_setting, grinder_rpm, dose_g, water_g, water_temp_c,
    bloom_water_g, bloom_seconds, pour_count, total_time_seconds, beverage_g, tds_percent,
    roast_date, production_no, taste_balance, taste_notes)
  values (
    coalesce((p_record->>'session_id')::uuid, gen_random_uuid()),
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

-- Several Finals in one transaction, one session: the first record's session_id if given
-- (filling empty tabs while editing), else a new one.
create or replace function public.save_espresso_calibrations(p_finals jsonb)
returns uuid[]
language plpgsql security invoker set search_path = '' as $$
declare
  v_final jsonb;
  v_ids uuid[] := '{}';
  v_session uuid;
begin
  if jsonb_typeof(p_finals) is distinct from 'array' or jsonb_array_length(p_finals) = 0 then
    raise exception 'Nothing to save' using errcode = '23514';
  end if;
  v_session := coalesce((p_finals->0->'record'->>'session_id')::uuid, gen_random_uuid());
  for v_final in select value from jsonb_array_elements(p_finals) loop
    v_ids := v_ids || public.save_espresso_calibration(
      coalesce(v_final->'record', '{}') || jsonb_build_object('session_id', v_session),
      array(select jsonb_array_elements_text(coalesce(v_final->'uses', '[]'))),
      array(select jsonb_array_elements_text(coalesce(v_final->'replace', '[]'))::uuid));
  end loop;
  return v_ids;
end;
$$;

create or replace function public.save_filter_calibrations(p_finals jsonb)
returns uuid[]
language plpgsql security invoker set search_path = '' as $$
declare
  v_final jsonb;
  v_ids uuid[] := '{}';
  v_session uuid;
begin
  if jsonb_typeof(p_finals) is distinct from 'array' or jsonb_array_length(p_finals) = 0 then
    raise exception 'Nothing to save' using errcode = '23514';
  end if;
  v_session := coalesce((p_finals->0->'record'->>'session_id')::uuid, gen_random_uuid());
  for v_final in select value from jsonb_array_elements(p_finals) loop
    v_ids := v_ids || public.save_filter_calibration(
      coalesce(v_final->'record', '{}') || jsonb_build_object('session_id', v_session),
      array(select jsonb_array_elements_text(coalesce(v_final->'uses', '[]'))),
      array(select jsonb_array_elements_text(coalesce(v_final->'replace', '[]'))::uuid));
  end loop;
  return v_ids;
end;
$$;

-- 5. Editing a session: change its Finals and add Finals for empty tabs, all or none ----------
-- p_updates: [{ "id": uuid, "revision": int, "record": {...values} }, ...]
-- p_finals:  as save_*_calibrations, for tabs that were empty.
-- A changed revision (someone edited meanwhile) gives 40001 and nothing is saved.

create function public.edit_espresso_calibrations(p_session uuid, p_updates jsonb, p_finals jsonb)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v jsonb;
  r jsonb;
begin
  if not private.can_edit_calibration('ESPRESSO', p_session) then
    raise exception 'You cannot edit this calibration' using errcode = '42501';
  end if;
  for v in select value from jsonb_array_elements(coalesce(p_updates, '[]')) loop
    r := v->'record';
    update public.calibrations set
      espresso_machine_id = (r->>'espresso_machine_id')::uuid,
      machine_name = r->>'machine_name',
      grind_setting = r->>'grind_setting',
      grinder_rpm = (r->>'grinder_rpm')::integer,
      water_temp_c = (r->>'water_temp_c')::numeric,
      pressure_bar = (r->>'pressure_bar')::numeric,
      preinfusion_seconds = (r->>'preinfusion_seconds')::numeric,
      basket_g = (r->>'basket_g')::numeric,
      roast_date = (r->>'roast_date')::date,
      production_no = nullif(btrim(r->>'production_no'), ''),
      dose_g = (r->>'dose_g')::numeric,
      yield_g = (r->>'yield_g')::numeric,
      extraction_time_seconds = (r->>'extraction_time_seconds')::numeric,
      tds_percent = (r->>'tds_percent')::numeric,
      taste_balance = r->>'taste_balance',
      taste_notes = nullif(btrim(r->>'taste_notes'), '')
    where id = (v->>'id')::uuid and session_id = p_session and revision = (v->>'revision')::integer
      and deleted_at is null;
    if not found then
      raise exception 'The calibration changed; check again' using errcode = '40001';
    end if;
  end loop;
  if jsonb_array_length(coalesce(p_finals, '[]')) > 0 then
    perform public.save_espresso_calibrations(
      (select jsonb_agg(jsonb_set(f, '{record,session_id}', to_jsonb(p_session::text))) from jsonb_array_elements(p_finals) f));
  end if;
end;
$$;
revoke all on function public.edit_espresso_calibrations(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.edit_espresso_calibrations(uuid, jsonb, jsonb) to authenticated;

create function public.edit_filter_calibrations(p_session uuid, p_updates jsonb, p_finals jsonb)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v jsonb;
  r jsonb;
begin
  if not private.can_edit_calibration('FILTER', p_session) then
    raise exception 'You cannot edit this calibration' using errcode = '42501';
  end if;
  for v in select value from jsonb_array_elements(coalesce(p_updates, '[]')) loop
    r := v->'record';
    update public.filter_calibrations set
      brewer_id = (r->>'brewer_id')::uuid,
      brewer_name = r->>'brewer_name',
      grind_setting = r->>'grind_setting',
      grinder_rpm = (r->>'grinder_rpm')::integer,
      dose_g = (r->>'dose_g')::numeric,
      water_g = (r->>'water_g')::numeric,
      water_temp_c = (r->>'water_temp_c')::numeric,
      bloom_water_g = (r->>'bloom_water_g')::numeric,
      bloom_seconds = (r->>'bloom_seconds')::numeric,
      pour_count = (r->>'pour_count')::integer,
      total_time_seconds = (r->>'total_time_seconds')::numeric,
      beverage_g = (r->>'beverage_g')::numeric,
      tds_percent = (r->>'tds_percent')::numeric,
      roast_date = (r->>'roast_date')::date,
      production_no = nullif(btrim(r->>'production_no'), ''),
      taste_balance = r->>'taste_balance',
      taste_notes = nullif(btrim(r->>'taste_notes'), '')
    where id = (v->>'id')::uuid and session_id = p_session and revision = (v->>'revision')::integer
      and deleted_at is null;
    if not found then
      raise exception 'The calibration changed; check again' using errcode = '40001';
    end if;
  end loop;
  if jsonb_array_length(coalesce(p_finals, '[]')) > 0 then
    perform public.save_filter_calibrations(
      (select jsonb_agg(jsonb_set(f, '{record,session_id}', to_jsonb(p_session::text))) from jsonb_array_elements(p_finals) f));
  end if;
end;
$$;
revoke all on function public.edit_filter_calibrations(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.edit_filter_calibrations(uuid, jsonb, jsonb) to authenticated;
