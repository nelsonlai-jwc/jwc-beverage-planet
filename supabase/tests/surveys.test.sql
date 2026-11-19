-- Daily / Custom calibrations and espresso drink rows.
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
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000d', 'other@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000d', 'other@test.local', 'OTHER BARISTA', 'BARISTA');
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000d', id from public.outlets where code = 'JB-YOUBAR';
insert into public.grinders (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Grinder 1');
insert into public.outlet_equipment (outlet_id, grinder_id)
  select id, '00000000-0000-0000-0000-0000000000a1' from public.outlets where code = 'JB-BROOOS';

grant select on all tables in schema public to anon, authenticated;
create temp table t_ids (k text primary key, v text);
grant all on t_ids to anon, authenticated;
set local role authenticated;

-- Barista records today; cannot open a survey.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
declare
  v_id uuid;
begin
  v_id := public.save_espresso_calibration(null, null,
    jsonb_build_object('outlet_id', (select id from public.outlets where code = 'JB-BROOOS'),
                       'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                       'grinder_id', '00000000-0000-0000-0000-0000000000a1', 'grind_setting', '12'),
    '[{"drink_type":"BLACK_HOT","dose_g":18,"yield_g":36,"extraction_time_seconds":28},
      {"drink_type":"MILK_HOT","dose_g":18,"yield_g":32,"extraction_time_seconds":25}]');
  insert into t_ids values ('cal', v_id);
  begin
    insert into public.surveys (subject_type, calibration_id, outlet_id, audience, drinks)
    select 'ESPRESSO', v_id, outlet_id, 'PUBLIC', array['BLACK_HOT'] from public.calibrations where id = v_id;
    raise exception 'barista should not open a survey';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

-- Manager opens a public survey (black + milk) and an outlet survey for the barista.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
declare
  v_cal uuid := (select v::uuid from t_ids where k = 'cal');
  v_outlet uuid := (select id from public.outlets where code = 'JB-BROOOS');
  v_id uuid;
begin
  -- A drink the record does not have is refused.
  begin
    insert into public.surveys (subject_type, calibration_id, outlet_id, audience, drinks)
    values ('ESPRESSO', v_cal, v_outlet, 'PUBLIC', array['BLACK_ICED']);
    raise exception 'drink not in record should fail';
  exception when check_violation then
    null;
  end;
  insert into public.surveys (subject_type, calibration_id, outlet_id, audience, drinks, max_responses)
  values ('ESPRESSO', v_cal, v_outlet, 'PUBLIC', array['BLACK_HOT', 'MILK_HOT'], 3)
  returning id into v_id;
  insert into t_ids select 'public', token from public.surveys where id = v_id;
  assert (select closes_at > now() + interval '23 hours' from public.surveys where id = v_id), 'closes in 24 h';

  insert into public.surveys (subject_type, calibration_id, outlet_id, audience, drinks)
  values ('ESPRESSO', v_cal, v_outlet, 'OUTLET', array['BLACK_HOT'])
  returning id into v_id;
  insert into t_ids select 'outlet', token from public.surveys where id = v_id;
  insert into t_ids values ('outlet_id', v_id);
  insert into public.survey_invitees values (v_id, '00000000-0000-0000-0000-00000000000c');
  -- Staff of another outlet cannot be invited.
  begin
    insert into public.survey_invitees values (v_id, '00000000-0000-0000-0000-00000000000d');
    raise exception 'other outlet staff should fail';
  exception when check_violation then
    null;
  end;
  assert (select count(*) from public.survey_outlet_people(v_outlet)) = 2, 'outlet people';
end;
$$;

-- Anyone answers the public survey.
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
declare
  v_token text := (select v from t_ids where k = 'public');
begin
  assert (public.get_survey(v_token) ->> 'bean') = 'Test Bean', 'public info';
  assert public.get_survey((select v from t_ids where k = 'outlet')) is null, 'outlet survey hidden from public';
  perform public.submit_survey_response(v_token, 'BLACK_HOT',
    '{"taste_balance":4.5,"tactile":4,"flavor":5}', array['CHOCOLATE'], null, 'Nice', 'device-0000000001', 'ip1');
  perform public.submit_survey_response(v_token, 'MILK_HOT',
    '{"visual":4,"taste_balance":4,"tactile":4.5,"flavor":4}', '{}', 'RIGHT', null, 'device-0000000001', 'ip1');
  assert jsonb_array_length(public.get_survey(v_token, 'device-0000000001') -> 'answered') = 2, 'answered list';
  begin
    perform public.submit_survey_response(v_token, 'BLACK_HOT',
      '{"taste_balance":3,"tactile":3,"flavor":3}', '{}', null, null, 'device-0000000001', 'ip1');
    raise exception 'second answer from one phone should fail';
  exception when unique_violation then
    null;
  end;
  begin
    perform public.submit_survey_response(v_token, 'BLACK_HOT',
      '{"taste_balance":4.3,"tactile":3,"flavor":3}', '{}', null, null, 'device-0000000002', 'ip2');
    raise exception 'bad score should fail';
  exception when check_violation then
    null;
  end;
  begin
    perform public.submit_survey_response(v_token, 'BLACK_HOT',
      '{"taste_balance":4,"tactile":3}', '{}', null, null, 'device-0000000002', 'ip2');
    raise exception 'missing criterion should fail';
  exception when check_violation then
    null;
  end;
  begin
    perform public.submit_survey_response(v_token, 'BLACK_ICED',
      '{"taste_balance":4,"tactile":3,"flavor":3}', '{}', null, null, 'device-0000000002', 'ip2');
    raise exception 'drink not in survey should fail';
  exception when check_violation then
    null;
  end;
  perform public.submit_survey_response(v_token, 'BLACK_HOT',
    '{"taste_balance":3,"tactile":3,"flavor":3}', '{}', null, null, 'device-0000000003', 'ip3');
  begin
    perform public.submit_survey_response(v_token, 'BLACK_HOT',
      '{"taste_balance":3,"tactile":3,"flavor":3}', '{}', null, null, 'device-0000000004', 'ip4');
    raise exception 'full survey should be closed';
  exception when object_not_in_prerequisite_state then
    null;
  end;
  -- Signed-out callers cannot answer the outlet survey.
  begin
    perform public.submit_survey_response((select v from t_ids where k = 'outlet'), 'BLACK_HOT',
      '{"taste_balance":3,"tactile":3,"flavor":3}', '{}', null, null, 'device-0000000005', 'ip5');
    raise exception 'anon should not answer outlet survey';
  exception when no_data_found then
    null;
  end;
end;
$$;

-- The invited barista sees and answers the outlet survey; the other barista cannot.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
do $$
begin
  assert public.get_survey((select v from t_ids where k = 'outlet')) is null, 'not invited';
  assert (select count(*) from public.surveys) = 0, 'not invited sees no surveys';
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
declare
  v_token text := (select v from t_ids where k = 'outlet');
begin
  assert (select count(*) from public.surveys) = 1, 'invitee sees the outlet survey';
  perform public.submit_survey_response(v_token, 'BLACK_HOT',
    '{"taste_balance":5,"tactile":5,"flavor":5}', '{}', null, null, null, null);
  assert (select count(*) from public.survey_responses) = 1, 'own answer only';
  update public.survey_responses set hidden = true;
  assert not exists (select 1 from public.survey_responses where hidden), 'barista cannot hide';
end;
$$;

-- Manager sees results and who answered, hides one, closes the survey.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  assert (select count(*) from public.survey_responses) = 4, 'manager sees all answers';
  assert (select answered from public.survey_invitee_status((select v::uuid from t_ids where k = 'outlet_id'))), 'answered';
  update public.survey_responses set hidden = true where comment = 'Nice';
  assert (select count(*) from public.survey_responses where hidden) = 1, 'manager hides';
  update public.surveys set closed_at = now();
  assert not (public.get_survey((select v from t_ids where k = 'public')) ->> 'open')::boolean, 'closed';
  begin
    update public.surveys set drinks = array['BLACK_HOT'];
    raise exception 'drinks should not change';
  exception when insufficient_privilege or check_violation then
    null;
  end;
end;
$$;

rollback;
