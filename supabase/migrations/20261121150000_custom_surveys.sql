-- Custom surveys (Nelson, 2026-11-21): rate something that is not a calibration record
-- or an approved recipe. The creator picks the type (Espresso, Filter or Signature
-- Beverage, stored as subject_type ESPRESSO / FILTER / RECIPE so the score sheets stay
-- the same) and gives it a name. A custom survey has a title and no record or recipe.

alter table public.surveys
  add column title text check (title is null or char_length(btrim(title)) between 1 and 80);

alter table public.surveys drop constraint surveys_check;
alter table public.surveys add constraint surveys_subject_check check (
  case subject_type
    when 'ESPRESSO' then drinks <@ array['BLACK_HOT', 'BLACK_ICED', 'MILK_HOT', 'MILK_ICED']
                         and filter_calibration_id is null and recipe_id is null
                         and (calibration_id is not null) = (title is null)
    when 'FILTER' then drinks = array['FILTER'] and calibration_id is null and recipe_id is null
                       and (filter_calibration_id is not null) = (title is null)
    else drinks = array['RECIPE'] and calibration_id is null and filter_calibration_id is null
         and (recipe_id is not null) = (title is null)
  end);

-- A new survey points at something the creator may use, and its outlet fits it.
-- A custom survey (title set) points at nothing, so only the role and outlet checks apply.
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
       or new.audience <> old.audience
       or new.drinks <> old.drinks
       or new.title is distinct from old.title
       or new.token <> old.token
       or new.created_by <> old.created_by then
      raise exception 'Only the closing time and note of a survey can change' using errcode = '23514';
    end if;
    return new;
  end if;

  if private.is_api_caller() and not (private.is_admin() or private.is_manager()) then
    raise exception 'Only a Manager or Admin can open a survey' using errcode = '42501';
  end if;
  if new.outlet_id is not null and private.is_api_caller() and not private.can_manage_outlet(new.outlet_id) then
    raise exception 'Choose an outlet you manage' using errcode = '42501';
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
      if new.outlet_id is distinct from v_outlet then
        raise exception 'A daily record''s survey belongs to its outlet' using errcode = '23514';
      end if;
    elsif private.is_api_caller() and v_owner <> auth.uid() then
      raise exception 'Only the owner of a custom record can survey it' using errcode = '42501';
    end if;
  else
    if not exists (
      select 1 from public.recipes r
       where r.id = new.recipe_id and r.status = 'ACTIVE' and not r.is_prep
         and r.current_approved_version_id is not null
         and (r.all_outlets or new.outlet_id is null
              or exists (select 1 from public.recipe_outlets ro
                          where ro.recipe_id = r.id and ro.outlet_id = new.outlet_id))) then
      raise exception 'Choose an approved drink recipe of this outlet' using errcode = '23514';
    end if;
    if new.outlet_id is null then
      raise exception 'A recipe survey belongs to an outlet' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- The fill page also shows a custom survey's name.
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
