-- Public tasting surveys on espresso calibration records.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'barista@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local', 'TEST ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local', 'TEST MANAGER', 'MANAGER'),
  ('00000000-0000-0000-0000-00000000000c', 'barista@test.local', 'TEST BARISTA', 'BARISTA');
update public.profiles set is_super_admin = true where role = 'ADMIN';
insert into public.user_outlets (user_id, outlet_id)
  select u, id from public.outlets,
    (values ('00000000-0000-0000-0000-00000000000b'::uuid), ('00000000-0000-0000-0000-00000000000c'::uuid)) as v(u)
   where code = 'JB-BROOOS';
insert into public.materials (id, name, brand, material_type_id, created_by, is_coffee_bean)
  select '00000000-0000-0000-0000-0000000000b1', 'Test Bean', 'Test', id,
         '00000000-0000-0000-0000-00000000000b', true
    from public.material_types where name = 'Other';
update public.materials set status = 'APPROVED' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.grinders (id, outlet_id, name)
  select '00000000-0000-0000-0000-0000000000a1', id, 'Grinder 1' from public.outlets where code = 'JB-BROOOS';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
insert into public.calibrations (id, outlet_id, coffee_bean_material_id, grinder_id, dose_g, yield_g,
                                 extraction_time_seconds, grind_setting)
  select '00000000-0000-0000-0000-0000000000c1', id, '00000000-0000-0000-0000-0000000000b1',
         '00000000-0000-0000-0000-0000000000a1', 18, 36, 28, '12'
    from public.outlets where code = 'JB-BROOOS';

-- Barista cannot open a survey.
do $$
begin
  begin
    insert into public.tasting_surveys (calibration_id, closes_at)
    values ('00000000-0000-0000-0000-0000000000c1', now() + interval '1 hour');
    raise exception 'barista should not open a survey';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

-- Manager opens one with espresso and a latte (milk recipe required).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  begin
    insert into public.tasting_surveys (calibration_id, serves_milk, closes_at)
    values ('00000000-0000-0000-0000-0000000000c1', true, now() + interval '1 hour');
    raise exception 'milk without recipe should fail';
  exception when check_violation then
    null;
  end;
end;
$$;
insert into public.tasting_surveys (calibration_id, serves_milk, milk_espresso_g, milk_ml, closes_at, max_responses)
values ('00000000-0000-0000-0000-0000000000c1', true, 36, 180, now() + interval '1 hour', 3);

-- Anyone (not signed in) reads and answers it.
reset role;
create temp table t_token as select token from public.tasting_surveys;
grant select on t_token to anon, authenticated;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
declare
  v_token text := (select token from t_token);
  v_info jsonb := public.get_tasting_survey(v_token);
begin
  assert v_info ->> 'bean' = 'Test Bean' and (v_info ->> 'open')::boolean, 'survey info';
  assert public.get_tasting_survey('nope') is null, 'unknown link';
  perform public.submit_tasting_response(v_token, 'ESPRESSO', null, 4.5, 4, 5, array['CHOCOLATE', 'NUTTY'],
                                         null, 'Nice', 'device-0000000001', 'ip1');
  perform public.submit_tasting_response(v_token, 'MILK', 4, 4, 4.5, 4, '{}', 'RIGHT', null,
                                         'device-0000000001', 'ip1');
  -- Same phone, same drink again.
  begin
    perform public.submit_tasting_response(v_token, 'ESPRESSO', null, 3, 3, 3, '{}', null, null,
                                           'device-0000000001', 'ip1');
    raise exception 'second answer from one phone should fail';
  exception when unique_violation then
    null;
  end;
  -- Score not on the 0.5 grid, and milk without its questions.
  begin
    perform public.submit_tasting_response(v_token, 'ESPRESSO', null, 4.3, 3, 3, '{}', null, null,
                                           'device-0000000002', 'ip2');
    raise exception 'bad score should fail';
  exception when check_violation then
    null;
  end;
  begin
    perform public.submit_tasting_response(v_token, 'MILK', null, 4, 4, 4, '{}', null, null,
                                           'device-0000000002', 'ip2');
    raise exception 'milk needs visual and milk amount';
  exception when check_violation then
    null;
  end;
  perform public.submit_tasting_response(v_token, 'ESPRESSO', null, 3, 3, 3, '{}', null, null,
                                         'device-0000000003', 'ip3');
  -- Limit of 3 answers reached.
  begin
    perform public.submit_tasting_response(v_token, 'ESPRESSO', null, 3, 3, 3, '{}', null, null,
                                           'device-0000000004', 'ip4');
    raise exception 'full survey should be closed';
  exception when object_not_in_prerequisite_state then
    null;
  end;
  -- anon cannot read tables directly.
  begin
    perform 1 from public.tasting_responses;
    raise exception 'anon should not read responses';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

-- Manager sees results and hides one; barista sees but cannot hide.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
declare
  v_count integer;
begin
  assert (select count(*) from public.tasting_responses) = 3, 'barista sees results';
  update public.tasting_responses set hidden = true;
  get diagnostics v_count = row_count;
  assert v_count = 0, 'barista cannot hide';
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  update public.tasting_responses set hidden = true where comment = 'Nice';
  assert (select count(*) from public.tasting_responses where hidden) = 1, 'manager hides';
  update public.tasting_surveys set closed_at = now();
  assert not (public.get_tasting_survey((select token from t_token)) ->> 'open')::boolean, 'closed';
end;
$$;

rollback;
