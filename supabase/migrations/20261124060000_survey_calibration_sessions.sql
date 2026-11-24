-- Feedback #16 (2026-11-24): each drink tab of one "Set as Final" save is its own calibration
-- record, all sharing a session_id. The survey form now offers one option per save, so an
-- Espresso survey may rate any drink of that save; calibration_id stays the save's first record.
-- Only the drink check changes; no data changes.

create or replace function private.surveys_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_purpose text;
  v_outlet uuid;
  v_owner uuid;
  v_deleted timestamptz;
begin
  if tg_op = 'UPDATE' then
    if new.subject_type <> old.subject_type
       or new.calibration_id is distinct from old.calibration_id
       or new.filter_calibration_id is distinct from old.filter_calibration_id
       or new.recipe_id is distinct from old.recipe_id
       or new.outlet_id is distinct from old.outlet_id
       or new.outlet_ids <> old.outlet_ids
       or new.audience <> old.audience
       or new.drinks <> old.drinks
       or new.title is distinct from old.title
       or new.token <> old.token
       or new.created_by <> old.created_by then
      raise exception 'Only the closing time and note of a survey can change' using errcode = '23514';
    end if;
    return new;
  end if;

  -- One list of outlets, each once, in the order ticked; outlet_id is the first.
  if cardinality(new.outlet_ids) = 0 and new.outlet_id is not null then
    new.outlet_ids := array[new.outlet_id];
  end if;
  new.outlet_ids := coalesce(
    (select array_agg(o order by n) from (
       select o, min(n) n from unnest(new.outlet_ids) with ordinality u(o, n) group by o) x),
    '{}');
  new.outlet_id := new.outlet_ids[1];

  if private.is_api_caller() and not (private.is_admin() or private.is_manager()) then
    raise exception 'Only a Manager or Admin can open a survey' using errcode = '42501';
  end if;
  if private.is_api_caller()
     and exists (select 1 from unnest(new.outlet_ids) o where not private.can_manage_outlet(o)) then
    raise exception 'Choose an outlet you manage' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(new.outlet_ids) o
              where not exists (select 1 from public.outlets x where x.id = o)) then
    raise exception 'Unknown outlet' using errcode = '23503';
  end if;

  if new.title is not null then
    new.title := btrim(new.title);
    return new;
  end if;

  if new.subject_type in ('ESPRESSO', 'FILTER') then
    if new.subject_type = 'ESPRESSO' then
      select purpose, outlet_id, created_by, deleted_at into v_purpose, v_outlet, v_owner, v_deleted
        from public.calibrations where id = new.calibration_id;
      if exists (select unnest(new.drinks) except
                 select d.drink_type
                   from public.calibration_drinks d
                   join public.calibrations c on c.id = d.calibration_id
                  where c.session_id = (select session_id from public.calibrations where id = new.calibration_id)
                    and c.deleted_at is null) then
        raise exception 'Choose drinks of this record' using errcode = '23514';
      end if;
    else
      select purpose, outlet_id, created_by, deleted_at into v_purpose, v_outlet, v_owner, v_deleted
        from public.filter_calibrations where id = new.filter_calibration_id;
    end if;
    if v_deleted is not null then
      raise exception 'This record is deleted' using errcode = '23514';
    end if;
    if v_purpose = 'DAILY' then
      if not v_outlet = any (new.outlet_ids) then
        raise exception 'A daily record''s survey includes its outlet' using errcode = '23514';
      end if;
    elsif private.is_api_caller() and v_owner <> auth.uid() then
      raise exception 'Only the owner of a custom record can survey it' using errcode = '42501';
    end if;
  else
    if cardinality(new.outlet_ids) = 0 then
      raise exception 'A recipe survey belongs to an outlet' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.recipes r
       where r.id = new.recipe_id and r.status = 'ACTIVE' and not r.is_prep
         and r.current_approved_version_id is not null
         and (r.all_outlets
              or not exists (select unnest(new.outlet_ids) except
                             select ro.outlet_id from public.recipe_outlets ro where ro.recipe_id = r.id))) then
      raise exception 'Choose an approved drink recipe of every ticked outlet' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;


-- Setting tabs as Final one at a time: after the first tab, later tabs join the same session
-- through edit_*_calibrations. A Manager may record a Daily calibration up to 7 days back, so
-- the person who started a session may also keep adding or updating its tabs on the day they
-- started it (Malaysia time). Other edit rights are unchanged.
create or replace function private.can_edit_calibration(p_kind text, p_session uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v record;
begin
  if p_kind = 'ESPRESSO' then
    select purpose, outlet_id, business_date, created_by, created_at into v
      from public.calibrations where session_id = p_session order by created_at, id limit 1;
  else
    select purpose, outlet_id, business_date, created_by, created_at into v
      from public.filter_calibrations where session_id = p_session order by created_at, id limit 1;
  end if;
  if not found then
    return false;
  end if;
  if v.purpose = 'DAILY' then
    return (v.business_date = public.my_business_date()
            and (v.created_by = auth.uid() or private.can_manage_outlet(v.outlet_id)))
        or (v.created_by = auth.uid()
            and (v.created_at at time zone 'Asia/Kuala_Lumpur')::date = (now() at time zone 'Asia/Kuala_Lumpur')::date);
  end if;
  return v.created_by = auth.uid() or private.is_admin();
end;
$$;
