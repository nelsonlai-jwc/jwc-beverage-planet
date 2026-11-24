-- Surveys for several outlets (Nelson, Feedback #13, 2026-11-24): every survey type
-- (Espresso, Filter, Signature Beverage, Custom) ticks outlets, or "All outlets", among
-- those the creator manages. Staff of any ticked outlet can be invited; Managers of any
-- ticked outlet run the survey. A daily record's outlet must be among them. A Signature
-- Beverage recipe must be available in every ticked outlet.
--
-- outlet_ids holds the ticked outlets. outlet_id stays as the first of them so older
-- code and the "outlet survey has an outlet" check keep working. Additive only.

alter table public.surveys
  add column outlet_ids uuid[] not null default '{}'
    check (array_position(outlet_ids, null) is null and cardinality(outlet_ids) <= 100);

alter table public.surveys disable trigger user;
update public.surveys set outlet_ids = array[outlet_id] where outlet_id is not null;
alter table public.surveys enable trigger user;

create index surveys_outlet_ids_idx on public.surveys using gin (outlet_ids);

-- Manager (or Admin) of at least one of these outlets.
create function private.can_manage_any_outlet(p_outlet_ids uuid[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from unnest(p_outlet_ids) o where private.can_manage_outlet(o));
$$;
grant execute on function private.can_manage_any_outlet(uuid[]) to authenticated;

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
                 select drink_type from public.calibration_drinks where calibration_id = new.calibration_id) then
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

-- Who runs a survey: its creator, the Super Admin, and Managers of any of its outlets.
create or replace function private.can_manage_survey(p_survey_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.surveys s
     where s.id = p_survey_id
       and (s.created_by = auth.uid() or private.is_admin()
            or private.can_manage_any_outlet(s.outlet_ids)));
$$;

-- Invitees are active staff of any of the survey's outlets.
create or replace function private.survey_invitees_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.surveys s
      join public.user_outlets uo on uo.outlet_id = any (s.outlet_ids) and uo.user_id = new.user_id
      join public.profiles p on p.id = new.user_id and p.status = 'ACTIVE'
     where s.id = new.survey_id and s.audience = 'OUTLET') then
    raise exception 'Invite active staff of this outlet' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop policy surveys_select on public.surveys;
drop policy surveys_update on public.surveys;
create policy surveys_select on public.surveys for select to authenticated
  using (created_by = auth.uid() or private.is_admin()
         or private.can_manage_any_outlet(outlet_ids)
         or exists (select 1 from public.survey_invitees i where i.survey_id = id and i.user_id = auth.uid()));
create policy surveys_update on public.surveys for update to authenticated
  using (created_by = auth.uid() or private.is_admin() or private.can_manage_any_outlet(outlet_ids))
  with check (created_by = auth.uid() or private.is_admin() or private.can_manage_any_outlet(outlet_ids));

-- The fill page lists every outlet of the survey.
create or replace function private.survey_info(p_survey public.surveys) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_survey.id,
    'subject_type', p_survey.subject_type,
    'title', p_survey.title,
    'audience', p_survey.audience,
    'drinks', to_jsonb(p_survey.drinks),
    'note', p_survey.note,
    'outlet', (select name from public.outlets where id = p_survey.outlet_id),
    'outlets', (select coalesce(jsonb_agg(o.name order by o.sort_order, o.name), '[]'::jsonb)
                  from public.outlets o where o.id = any (p_survey.outlet_ids)),
    'date', coalesce(c.business_date, f.business_date, (p_survey.created_at at time zone 'Asia/Kuala_Lumpur')::date),
    'bean', m.name,
    'brand', m.brand,
    'recipe', v.product_name,
    'temperature', v.temperature,
    'closes_at', p_survey.closes_at,
    'open', p_survey.closed_at is null and p_survey.closes_at > now()
            and coalesce(c.deleted_at, f.deleted_at) is null
            and (select count(*) from public.survey_responses r where r.survey_id = p_survey.id) < p_survey.max_responses)
    from (select 1) one
    left join public.calibrations c on c.id = p_survey.calibration_id
    left join public.filter_calibrations f on f.id = p_survey.filter_calibration_id
    left join public.materials m on m.id = coalesce(c.coffee_bean_material_id, f.coffee_bean_material_id)
    left join public.recipes r on r.id = p_survey.recipe_id
    left join public.recipe_versions v on v.id = r.current_approved_version_id;
$$;
