-- delete_survey: creator, Super Admin and outlet Admins of the survey's outlets may
-- delete; answers go too. Runs in one transaction and rolls back.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'super@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'outletadmin@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'otheradmin@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'manager2@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'super@test.local', 'SUPER', 'ADMIN'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local', 'MANAGER', 'MANAGER'),
  ('00000000-0000-0000-0000-00000000000c', 'outletadmin@test.local', 'OUTLET ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-00000000000d', 'otheradmin@test.local', 'OTHER ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-00000000000e', 'manager2@test.local', 'SECOND MANAGER', 'MANAGER');
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-00000000000a';
insert into public.user_outlets (user_id, outlet_id)
  select u, id from public.outlets,
    (values ('00000000-0000-0000-0000-00000000000b'::uuid), ('00000000-0000-0000-0000-00000000000c'::uuid),
            ('00000000-0000-0000-0000-00000000000e'::uuid)) as v(u)
   where code = 'JB-BROOOS';
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000d', id from public.outlets where code = 'JB-YOUBAR';

grant select on all tables in schema public to anon, authenticated;
set local role authenticated;

-- The Manager creates three public surveys.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
insert into public.surveys (id, subject_type, title, outlet_ids, audience, drinks)
  select ('60000000-0000-0000-0000-00000000000' || i)::uuid, 'FILTER', 'S' || i,
         array[(select id from public.outlets where code = 'JB-BROOOS')], 'PUBLIC', array['FILTER']
    from generate_series(1, 3) i;
reset role;
insert into public.survey_responses (survey_id, drink, device_id, scores)
values ('60000000-0000-0000-0000-000000000001', 'FILTER', 'test-device-0000001',
        '{"aroma":3,"flavor":3,"aftertaste":3,"acidity":3,"body":3,"balance":3,"overall":3}');
set local role authenticated;

-- Another Manager of the outlet cannot delete.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
do $$
begin
  perform public.delete_survey('60000000-0000-0000-0000-000000000001');
  raise exception 'other manager should fail';
exception when insufficient_privilege then null;
end;
$$;

-- An Admin of another outlet cannot delete.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
do $$
begin
  perform public.delete_survey('60000000-0000-0000-0000-000000000001');
  raise exception 'other outlet admin should fail';
exception when insufficient_privilege then null;
end;
$$;

-- The creator deletes a survey with an answer; the answer goes too.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
select public.delete_survey('60000000-0000-0000-0000-000000000001');
-- The outlet Admin and the Super Admin can delete too.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
select public.delete_survey('60000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select public.delete_survey('60000000-0000-0000-0000-000000000003');

reset role;
do $$
begin
  assert not exists (select 1 from public.surveys where id::text like '60000000-%'), 'all deleted';
  assert not exists (select 1 from public.survey_responses
                      where survey_id = '60000000-0000-0000-0000-000000000001'), 'answers deleted';
end;
$$;

rollback;
