-- Surveys as their own section (Nelson, 2026-11-18). Replaces the tasting survey that
-- hung under an espresso record (tasting_surveys / tasting_responses had no rows).
--
-- Subject: an espresso record (daily or custom; chosen drink types), a filter record
--   (daily or custom) or an outlet's approved beverage recipe.
-- Audience: OUTLET (ticked staff of one outlet answer after signing in; who has not
--   answered is shown) or PUBLIC (anyone with the QR code, one answer per phone).
-- Closes at the chosen time, or 24 hours after it opens.
-- Scores 0-6 in steps of 0.5:
--   black espresso: taste balance, tactile, flavour (barista championship)
--   milk drink: visual, taste balance, tactile, flavour + milk ratio
--   filter: aroma, flavour, aftertaste, acidity, body, balance, overall (brewers cup)
--   beverage recipe: visual, taste balance, tactile, flavour, overall + comment

drop function public.submit_tasting_response(text, text, numeric, numeric, numeric, numeric, text[], text, text, text, text);
drop function public.get_tasting_survey(text);
drop table public.tasting_responses;
drop table public.tasting_surveys;

-- Criteria per drink ------------------------------------------------------------

create function private.survey_criteria(p_drink text) returns text[]
language sql immutable set search_path = '' as $$
  select case
    when p_drink in ('BLACK_HOT', 'BLACK_ICED') then array['taste_balance', 'tactile', 'flavor']
    when p_drink in ('MILK_HOT', 'MILK_ICED') then array['visual', 'taste_balance', 'tactile', 'flavor']
    when p_drink = 'FILTER' then array['aroma', 'flavor', 'aftertaste', 'acidity', 'body', 'balance', 'overall']
    when p_drink = 'RECIPE' then array['visual', 'taste_balance', 'tactile', 'flavor', 'overall']
  end;
$$;

-- Every criterion of the drink scored 0-6 in steps of 0.5, nothing else.
create function private.survey_scores_ok(p_drink text, p_scores jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_scores) = 'object'
     and (select array_agg(k order by k) from jsonb_object_keys(p_scores) k)
         = (select array_agg(c order by c) from unnest(private.survey_criteria(p_drink)) c)
     and not exists (
       select 1 from jsonb_each(p_scores) e
        where jsonb_typeof(e.value) <> 'number'
           or not private.tasting_score_ok((e.value #>> '{}')::numeric));
$$;

-- Surveys -----------------------------------------------------------------------

create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('ESPRESSO', 'FILTER', 'RECIPE')),
  calibration_id uuid references public.calibrations (id) on delete restrict,
  filter_calibration_id uuid references public.filter_calibrations (id) on delete restrict,
  recipe_id uuid references public.recipes (id) on delete restrict,
  -- OUTLET audience: the outlet whose staff answer. Also the outlet shown and whose
  -- Managers see the results (null for a public survey of a custom record).
  outlet_id uuid references public.outlets (id) on delete restrict,
  audience text not null check (audience in ('OUTLET', 'PUBLIC')),
  drinks text[] not null check (cardinality(drinks) between 1 and 4),
  note text check (char_length(note) <= 200),
  -- Random link code; the fill pages find the survey only by this.
  token text not null unique default encode(extensions.gen_random_bytes(16), 'hex')
    check (char_length(token) >= 20),
  closes_at timestamptz not null default now() + interval '24 hours',
  closed_at timestamptz,
  max_responses integer not null default 200 check (max_responses between 1 and 1000),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  check (case subject_type
           when 'ESPRESSO' then calibration_id is not null and filter_calibration_id is null and recipe_id is null
                                and drinks <@ array['BLACK_HOT', 'BLACK_ICED', 'MILK_HOT', 'MILK_ICED']
           when 'FILTER' then filter_calibration_id is not null and calibration_id is null and recipe_id is null
                              and drinks = array['FILTER']
           else recipe_id is not null and calibration_id is null and filter_calibration_id is null
                and drinks = array['RECIPE']
         end),
  check (audience = 'PUBLIC' or outlet_id is not null)
);
create index surveys_outlet_idx on public.surveys (outlet_id, created_at);
create trigger surveys_touch before update on public.surveys
  for each row execute function private.touch_row();
create trigger audit_surveys after insert or update or delete on public.surveys
  for each row execute function private.audit_row('token');

create table public.survey_invitees (
  survey_id uuid not null references public.surveys (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete restrict,
  primary key (survey_id, user_id)
);
create index survey_invitees_user_idx on public.survey_invitees (user_id);

create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete restrict,
  drink text not null,
  scores jsonb not null check (private.survey_scores_ok(drink, scores)),
  flavor_tags text[] not null default '{}' check (flavor_tags <@ array[
    'FRUITY', 'BERRY', 'CITRUS', 'STONE_FRUIT', 'FLORAL', 'CHOCOLATE', 'CARAMEL', 'NUTTY', 'SPICY', 'ROASTED']),
  milk_amount text check (milk_amount in ('TOO_MUCH', 'RIGHT', 'TOO_LITTLE')),
  comment text check (char_length(comment) <= 500),
  -- OUTLET: the signed-in staff member. PUBLIC: the phone (cookie) and network hash.
  respondent_id uuid references public.profiles (id) on delete restrict,
  device_id text check (char_length(device_id) between 16 and 64),
  ip_hash text check (char_length(ip_hash) <= 64),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  check ((drink like 'MILK%') = (milk_amount is not null)),
  check (respondent_id is not null or device_id is not null),
  unique (survey_id, drink, respondent_id),
  unique (survey_id, drink, device_id)
);
create index survey_responses_ip_idx on public.survey_responses (survey_id, ip_hash, created_at);

-- Who runs a survey: its creator, the Super Admin, and Managers of its outlet.
create function private.can_manage_survey(p_survey_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.surveys s
     where s.id = p_survey_id
       and (s.created_by = auth.uid() or private.is_admin()
            or (s.outlet_id is not null and private.can_manage_outlet(s.outlet_id))));
$$;
grant execute on function private.can_manage_survey(uuid) to authenticated;

-- A new survey points at something the creator may use, and its outlet fits it.
create function private.surveys_guard() returns trigger
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
create trigger surveys_guard before insert or update on public.surveys
  for each row execute function private.surveys_guard();

-- Invitees are active staff of the survey's outlet.
create function private.survey_invitees_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.surveys s
      join public.user_outlets uo on uo.outlet_id = s.outlet_id and uo.user_id = new.user_id
      join public.profiles p on p.id = new.user_id and p.status = 'ACTIVE'
     where s.id = new.survey_id and s.audience = 'OUTLET') then
    raise exception 'Invite active staff of this outlet' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger survey_invitees_guard before insert on public.survey_invitees
  for each row execute function private.survey_invitees_guard();

alter table public.surveys enable row level security;
alter table public.survey_invitees enable row level security;
alter table public.survey_responses enable row level security;

create policy surveys_select on public.surveys for select to authenticated
  using (created_by = auth.uid() or private.is_admin()
         or (outlet_id is not null and private.can_manage_outlet(outlet_id))
         or exists (select 1 from public.survey_invitees i where i.survey_id = id and i.user_id = auth.uid()));
create policy surveys_insert on public.surveys for insert to authenticated
  with check (created_by = auth.uid());
create policy surveys_update on public.surveys for update to authenticated
  using (created_by = auth.uid() or private.is_admin()
         or (outlet_id is not null and private.can_manage_outlet(outlet_id)))
  with check (created_by = auth.uid() or private.is_admin()
         or (outlet_id is not null and private.can_manage_outlet(outlet_id)));
create policy survey_invitees_select on public.survey_invitees for select to authenticated
  using (user_id = auth.uid() or private.can_manage_survey(survey_id));
create policy survey_invitees_insert on public.survey_invitees for insert to authenticated
  with check (private.can_manage_survey(survey_id));
create policy survey_responses_select on public.survey_responses for select to authenticated
  using (private.can_manage_survey(survey_id) or respondent_id = auth.uid());
create policy survey_responses_hide on public.survey_responses for update to authenticated
  using (private.can_manage_survey(survey_id)) with check (private.can_manage_survey(survey_id));

revoke all on public.surveys, public.survey_invitees, public.survey_responses from anon, authenticated;
grant select, insert on public.surveys to authenticated;
grant update (closes_at, closed_at, note) on public.surveys to authenticated;
grant select, insert on public.survey_invitees to authenticated;
grant select on public.survey_responses to authenticated;
grant update (hidden) on public.survey_responses to authenticated;

-- What the fill page shows ---------------------------------------------------------

create function private.survey_info(p_survey public.surveys) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_survey.id,
    'subject_type', p_survey.subject_type,
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

-- Public surveys for anyone; outlet surveys for invitees and those who run them.
-- Also returns the drinks this caller already answered.
create function public.get_survey(p_token text, p_device_id text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_survey public.surveys;
begin
  select * into v_survey from public.surveys where token = p_token;
  if not found then
    return null;
  end if;
  if v_survey.audience = 'OUTLET' and not (
       exists (select 1 from public.survey_invitees i where i.survey_id = v_survey.id and i.user_id = auth.uid())
       or private.can_manage_survey(v_survey.id)) then
    return null;
  end if;
  return private.survey_info(v_survey) || jsonb_build_object('answered', (
    select coalesce(jsonb_agg(distinct r.drink), '[]'::jsonb) from public.survey_responses r
     where r.survey_id = v_survey.id
       and (case when v_survey.audience = 'OUTLET' then r.respondent_id = auth.uid()
                 else r.device_id = p_device_id end)));
end;
$$;

-- One answer. Errors: P0002 not found or not invited, 55000 closed or full,
-- 54000 too many from one network, 23505 already answered this drink.
create function public.submit_survey_response(
  p_token text,
  p_drink text,
  p_scores jsonb,
  p_flavor_tags text[],
  p_milk_amount text,
  p_comment text,
  p_device_id text,
  p_ip_hash text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_survey public.surveys;
  v_info jsonb;
begin
  select * into v_survey from public.surveys where token = p_token for update;
  if not found then
    raise exception 'Survey not found' using errcode = 'P0002';
  end if;
  if v_survey.audience = 'OUTLET' and (auth.uid() is null or not exists (
       select 1 from public.survey_invitees i where i.survey_id = v_survey.id and i.user_id = auth.uid())) then
    raise exception 'Survey not found' using errcode = 'P0002';
  end if;
  v_info := private.survey_info(v_survey);
  if not (v_info->>'open')::boolean then
    raise exception 'Survey is closed' using errcode = '55000';
  end if;
  if not p_drink = any (v_survey.drinks) then
    raise exception 'This drink is not part of the survey' using errcode = '23514';
  end if;
  if v_survey.audience = 'PUBLIC' and p_ip_hash is not null and (
    select count(*) from public.survey_responses r
     where r.survey_id = v_survey.id and r.ip_hash = p_ip_hash and r.created_at > now() - interval '10 minutes'
  ) >= 30 then
    raise exception 'Too many answers from this network' using errcode = '54000';
  end if;
  insert into public.survey_responses (
    survey_id, drink, scores, flavor_tags, milk_amount, comment, respondent_id, device_id, ip_hash)
  values (
    v_survey.id, p_drink, p_scores,
    case when p_drink = 'RECIPE' then '{}' else coalesce(p_flavor_tags, '{}') end,
    case when p_drink like 'MILK%' then p_milk_amount end,
    nullif(btrim(coalesce(p_comment, '')), ''),
    case when v_survey.audience = 'OUTLET' then auth.uid() end,
    case when v_survey.audience = 'PUBLIC' then p_device_id end,
    case when v_survey.audience = 'PUBLIC' then p_ip_hash end);
end;
$$;

-- Staff of an outlet, for ticking who answers (those who run surveys there).
create function public.survey_outlet_people(p_outlet_id uuid)
returns table (id uuid, full_name text, role public.user_role)
language sql stable security definer set search_path = '' as $$
  select p.id, coalesce(nullif(p.full_name, ''), p.email), p.role
    from public.user_outlets uo
    join public.profiles p on p.id = uo.user_id and p.status = 'ACTIVE'
   where uo.outlet_id = p_outlet_id and private.can_manage_outlet(p_outlet_id)
   order by 2;
$$;

-- Invitees of a survey and whether each has answered (those who run it).
create function public.survey_invitee_status(p_survey_id uuid)
returns table (id uuid, full_name text, answered boolean)
language sql stable security definer set search_path = '' as $$
  select p.id, coalesce(nullif(p.full_name, ''), p.email),
         exists (select 1 from public.survey_responses r where r.survey_id = i.survey_id and r.respondent_id = i.user_id)
    from public.survey_invitees i
    join public.profiles p on p.id = i.user_id
   where i.survey_id = p_survey_id and private.can_manage_survey(p_survey_id)
   order by 3, 2;
$$;

revoke execute on function public.get_survey(text, text) from public;
revoke execute on function public.submit_survey_response(text, text, jsonb, text[], text, text, text, text) from public;
revoke execute on function public.survey_outlet_people(uuid) from public;
revoke execute on function public.survey_invitee_status(uuid) from public;
grant execute on function public.get_survey(text, text) to anon, authenticated;
grant execute on function public.submit_survey_response(text, text, jsonb, text[], text, text, text, text) to anon, authenticated;
grant execute on function public.survey_outlet_people(uuid) to authenticated;
grant execute on function public.survey_invitee_status(uuid) to authenticated;
