-- Super Admins appear in every outlet's survey staff list and can be invited.
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

grant select on all tables in schema public to anon, authenticated;
set local role authenticated;

-- The Manager sees the outlet's staff plus the Super Admin, not other outlets' staff.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
declare
  v_brooos uuid := (select id from public.outlets where code = 'JB-BROOOS');
  v_id uuid;
begin
  assert (select array_agg(full_name order by full_name) from public.survey_outlet_people(v_brooos))
    = array['TEST ADMIN', 'TEST BARISTA', 'TEST MANAGER'], 'list has super admin and outlet staff';

  insert into public.surveys (subject_type, title, outlet_ids, audience, drinks)
  values ('FILTER', 'Brooos', array[v_brooos], 'OUTLET', array['FILTER'])
  returning id into v_id;
  insert into public.survey_invitees values
    (v_id, '00000000-0000-0000-0000-00000000000a'),
    (v_id, '00000000-0000-0000-0000-00000000000c');

  -- Staff of another outlet still cannot be invited.
  begin
    insert into public.survey_invitees values (v_id, '00000000-0000-0000-0000-00000000000d');
    raise exception 'other outlet staff should fail';
  exception when check_violation then
    null;
  end;
end;
$$;

rollback;
