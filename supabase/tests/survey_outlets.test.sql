-- Surveys for several outlets (Feedback #13).
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'barista@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'other@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local', 'TEST ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local', 'TEST MANAGER', 'MANAGER'),
  ('00000000-0000-0000-0000-00000000000c', 'barista@test.local', 'TEST BARISTA', 'BARISTA'),
  ('00000000-0000-0000-0000-00000000000d', 'other@test.local', 'OTHER BARISTA', 'BARISTA');
update public.profiles set is_super_admin = true where role = 'ADMIN';
insert into public.user_outlets (user_id, outlet_id)
  select u, id from public.outlets,
    (values ('00000000-0000-0000-0000-00000000000b'::uuid), ('00000000-0000-0000-0000-00000000000c'::uuid)) as v(u)
   where code = 'JB-BROOOS';
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000d', id from public.outlets where code = 'JB-YOUBAR';

-- An approved drink recipe of JB-BROOOS only.
insert into public.recipes (id, outlet_id, is_prep, created_by)
  select '40000000-0000-0000-0000-000000000001', id, false, '00000000-0000-0000-0000-00000000000b' from public.outlets where code = 'JB-BROOOS';
insert into public.recipe_versions (id, recipe_id, version_no, status, product_name, created_by)
values ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 'APPROVED',
        'Latte', '00000000-0000-0000-0000-00000000000b');
update public.recipes set current_approved_version_id = '50000000-0000-0000-0000-000000000001'
 where id = '40000000-0000-0000-0000-000000000001';
insert into public.recipe_outlets (recipe_id, outlet_id)
  select '40000000-0000-0000-0000-000000000001', id from public.outlets where code = 'JB-BROOOS'
  on conflict do nothing;

-- Older surveys keep their one outlet.
do $$
begin
  assert (select count(*) from public.surveys where outlet_id is not null
                                              and outlet_ids <> array[outlet_id]) = 0, 'backfill';
end;
$$;

grant select on all tables in schema public to anon, authenticated;
set local role authenticated;

-- A Manager cannot tick an outlet they do not manage.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  insert into public.surveys (subject_type, title, outlet_ids, audience, drinks)
  select 'FILTER', 'Two outlets', array_agg(id order by code), 'OUTLET', array['FILTER']
    from public.outlets where code in ('JB-BROOOS', 'JB-YOUBAR');
  raise exception 'manager ticking another outlet should fail';
exception when insufficient_privilege then
  null;
end;
$$;

-- The Super Admin opens a custom survey for two outlets and invites staff of both.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
declare
  v_brooos uuid := (select id from public.outlets where code = 'JB-BROOOS');
  v_youbar uuid := (select id from public.outlets where code = 'JB-YOUBAR');
  v_id uuid;
begin
  insert into public.surveys (subject_type, title, outlet_ids, audience, drinks)
  values ('FILTER', 'Two outlets', array[v_youbar, v_brooos, v_youbar], 'OUTLET', array['FILTER'])
  returning id into v_id;
  assert (select outlet_ids = array[v_youbar, v_brooos] and outlet_id = v_youbar
            from public.surveys where id = v_id), 'outlets kept once, first is outlet_id';
  insert into public.survey_invitees values
    (v_id, '00000000-0000-0000-0000-00000000000c'),
    (v_id, '00000000-0000-0000-0000-00000000000d');
  assert jsonb_array_length(private.survey_info((select s from public.surveys s where s.id = v_id)) -> 'outlets') = 2,
    'info lists both outlets';
  -- Outlets cannot change later.
  begin
    update public.surveys set outlet_ids = array[v_brooos] where id = v_id;
    raise exception 'changing outlets should fail';
  exception when check_violation or insufficient_privilege then
    null;
  end;

  -- A recipe must be available in every ticked outlet.
  begin
    insert into public.surveys (subject_type, recipe_id, outlet_ids, audience, drinks)
    values ('RECIPE', '40000000-0000-0000-0000-000000000001', array[v_brooos, v_youbar], 'OUTLET', array['RECIPE']);
    raise exception 'recipe missing in one outlet should fail';
  exception when check_violation then
    null;
  end;
  insert into public.surveys (subject_type, recipe_id, outlet_ids, audience, drinks)
  values ('RECIPE', '40000000-0000-0000-0000-000000000001', array[v_brooos], 'OUTLET', array['RECIPE']);
end;
$$;

-- The Manager of one ticked outlet runs the survey.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  assert (select count(*) from public.surveys where title = 'Two outlets') = 1, 'manager sees it';
  assert private.can_manage_survey((select id from public.surveys where title = 'Two outlets')), 'manager runs it';
end;
$$;

rollback;
