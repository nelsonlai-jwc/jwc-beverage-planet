-- Public tasting surveys on an espresso calibration record (Nelson, 2026-11-18).
-- Admin/Manager opens a survey, shares a QR code, anyone fills it without signing in.
-- Scores follow the barista championship style: 0-6 in steps of 0.5.

create table public.tasting_surveys (
  id uuid primary key default gen_random_uuid(),
  calibration_id uuid not null unique references public.calibrations (id) on delete restrict,
  -- Random link code; the public page finds the survey only by this.
  token text not null unique default encode(extensions.gen_random_bytes(16), 'hex')
    check (char_length(token) >= 20),
  serves_espresso boolean not null default true,
  serves_milk boolean not null default false,
  milk_espresso_g numeric(6, 1) check (milk_espresso_g > 0),
  milk_ml numeric(6, 1) check (milk_ml > 0),
  closes_at timestamptz not null,
  closed_at timestamptz,
  max_responses integer not null default 200 check (max_responses between 1 and 1000),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  check (serves_espresso or serves_milk),
  check (not serves_milk or (milk_espresso_g is not null and milk_ml is not null))
);
create trigger tasting_surveys_touch before update on public.tasting_surveys
  for each row execute function private.touch_row();
create trigger audit_tasting_surveys after insert or update or delete on public.tasting_surveys
  for each row execute function private.audit_row('token');

create function private.tasting_score_ok(p numeric) returns boolean
language sql immutable set search_path = '' as $$
  select p between 0 and 6 and p * 2 = floor(p * 2);
$$;

create table public.tasting_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.tasting_surveys (id) on delete restrict,
  drink text not null check (drink in ('ESPRESSO', 'MILK')),
  visual numeric(2, 1) check (private.tasting_score_ok(visual)),
  taste_balance numeric(2, 1) not null check (private.tasting_score_ok(taste_balance)),
  tactile numeric(2, 1) not null check (private.tasting_score_ok(tactile)),
  flavor numeric(2, 1) not null check (private.tasting_score_ok(flavor)),
  flavor_tags text[] not null default '{}' check (flavor_tags <@ array[
    'FRUITY', 'BERRY', 'CITRUS', 'STONE_FRUIT', 'FLORAL', 'CHOCOLATE', 'CARAMEL', 'NUTTY', 'SPICY', 'ROASTED']),
  milk_amount text check (milk_amount in ('TOO_MUCH', 'RIGHT', 'TOO_LITTLE')),
  comment text check (char_length(comment) <= 140),
  device_id text not null check (char_length(device_id) between 16 and 64),
  ip_hash text check (char_length(ip_hash) <= 64),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  check ((drink = 'MILK') = (visual is not null and milk_amount is not null)),
  -- One answer per phone, survey and drink.
  unique (survey_id, device_id, drink)
);
create index tasting_responses_ip_idx on public.tasting_responses (survey_id, ip_hash, created_at);

alter table public.tasting_surveys enable row level security;
alter table public.tasting_responses enable row level security;

-- Outlet members see surveys and results; Manager/Admin of the outlet open and change them.
create policy tasting_surveys_select on public.tasting_surveys for select to authenticated
  using (exists (select 1 from public.calibrations c
                  where c.id = calibration_id and private.is_outlet_member(c.outlet_id)));
create policy tasting_surveys_insert on public.tasting_surveys for insert to authenticated
  with check (created_by = auth.uid() and exists (
    select 1 from public.calibrations c
     where c.id = calibration_id and c.deleted_at is null and private.can_manage_outlet(c.outlet_id)));
create policy tasting_surveys_update on public.tasting_surveys for update to authenticated
  using (exists (select 1 from public.calibrations c
                  where c.id = calibration_id and private.can_manage_outlet(c.outlet_id)))
  with check (exists (select 1 from public.calibrations c
                       where c.id = calibration_id and private.can_manage_outlet(c.outlet_id)));
create policy tasting_responses_select on public.tasting_responses for select to authenticated
  using (exists (select 1 from public.tasting_surveys s join public.calibrations c on c.id = s.calibration_id
                  where s.id = survey_id and private.is_outlet_member(c.outlet_id)));
create policy tasting_responses_hide on public.tasting_responses for update to authenticated
  using (exists (select 1 from public.tasting_surveys s join public.calibrations c on c.id = s.calibration_id
                  where s.id = survey_id and private.can_manage_outlet(c.outlet_id)))
  with check (exists (select 1 from public.tasting_surveys s join public.calibrations c on c.id = s.calibration_id
                       where s.id = survey_id and private.can_manage_outlet(c.outlet_id)));

revoke all on public.tasting_surveys, public.tasting_responses from anon, authenticated;
grant select, insert on public.tasting_surveys to authenticated;
grant update (serves_espresso, serves_milk, milk_espresso_g, milk_ml, closes_at, closed_at)
  on public.tasting_surveys to authenticated;
grant select on public.tasting_responses to authenticated;
grant update (hidden) on public.tasting_responses to authenticated;

-- Public: what the survey page shows, found by its link code.
create function public.get_tasting_survey(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'bean', m.name,
    'brand', m.brand,
    'outlet', o.name,
    'business_date', c.business_date,
    'serves_espresso', s.serves_espresso,
    'serves_milk', s.serves_milk,
    'milk_espresso_g', s.milk_espresso_g,
    'milk_ml', s.milk_ml,
    'open', s.closed_at is null and s.closes_at > now() and c.deleted_at is null
            and (select count(*) from public.tasting_responses r where r.survey_id = s.id) < s.max_responses)
    from public.tasting_surveys s
    join public.calibrations c on c.id = s.calibration_id
    join public.materials m on m.id = c.coffee_bean_material_id
    join public.outlets o on o.id = c.outlet_id
   where s.token = p_token;
$$;

-- Public: one answer. Errors: P0002 not found, 55000 closed or full, 54000 too many
-- from one network, 23505 this phone already answered this drink.
create function public.submit_tasting_response(
  p_token text,
  p_drink text,
  p_visual numeric,
  p_taste_balance numeric,
  p_tactile numeric,
  p_flavor numeric,
  p_flavor_tags text[],
  p_milk_amount text,
  p_comment text,
  p_device_id text,
  p_ip_hash text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_survey public.tasting_surveys%rowtype;
  v_deleted timestamptz;
begin
  select s.* into v_survey from public.tasting_surveys s where s.token = p_token for update;
  if not found then
    raise exception 'Survey not found' using errcode = 'P0002';
  end if;
  select c.deleted_at into v_deleted from public.calibrations c where c.id = v_survey.calibration_id;
  if v_survey.closed_at is not null or v_survey.closes_at <= now() or v_deleted is not null
     or (select count(*) from public.tasting_responses r where r.survey_id = v_survey.id) >= v_survey.max_responses then
    raise exception 'Survey is closed' using errcode = '55000';
  end if;
  if (p_drink = 'ESPRESSO' and not v_survey.serves_espresso) or (p_drink = 'MILK' and not v_survey.serves_milk) then
    raise exception 'This drink is not part of the survey' using errcode = '23514';
  end if;
  if p_ip_hash is not null and (
    select count(*) from public.tasting_responses r
     where r.survey_id = v_survey.id and r.ip_hash = p_ip_hash and r.created_at > now() - interval '10 minutes'
  ) >= 30 then
    raise exception 'Too many answers from this network' using errcode = '54000';
  end if;
  insert into public.tasting_responses (
    survey_id, drink, visual, taste_balance, tactile, flavor, flavor_tags, milk_amount, comment, device_id, ip_hash)
  values (
    v_survey.id, p_drink,
    case when p_drink = 'MILK' then p_visual end,
    p_taste_balance, p_tactile, p_flavor,
    coalesce(p_flavor_tags, '{}'),
    case when p_drink = 'MILK' then p_milk_amount end,
    nullif(btrim(coalesce(p_comment, '')), ''),
    p_device_id, p_ip_hash);
end;
$$;

revoke execute on function public.get_tasting_survey(text) from public;
revoke execute on function public.submit_tasting_response(text, text, numeric, numeric, numeric, numeric, text[], text, text, text, text) from public;
grant execute on function public.get_tasting_survey(text) to anon, authenticated;
grant execute on function public.submit_tasting_response(text, text, numeric, numeric, numeric, numeric, text[], text, text, text, text) to anon, authenticated;
