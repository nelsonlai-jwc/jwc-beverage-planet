-- Feedback #16: tabs set as Final one at a time join one session; a survey offers one option per
-- session and may rate any drink of it. Runs in one transaction and rolls back.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'barista@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local', 'TEST MANAGER', 'MANAGER'),
  ('00000000-0000-0000-0000-00000000000c', 'barista@test.local', 'TEST BARISTA', 'BARISTA');
insert into public.user_outlets (user_id, outlet_id)
  select u, id from public.outlets,
    (values ('00000000-0000-0000-0000-00000000000b'::uuid), ('00000000-0000-0000-0000-00000000000c'::uuid)) as v(u)
   where code = 'JB-BROOOS';

insert into public.material_types (name, sort_order) values ('Coffee Bean', 99) on conflict (name) do nothing;
insert into public.materials (id, name, brand, material_type_id, created_by, espresso_calibration, filter_calibration)
  select '00000000-0000-0000-0000-0000000000b1', 'Test Bean', 'Test', id,
         '00000000-0000-0000-0000-00000000000b', true, true
    from public.material_types where name = 'Coffee Bean';
update public.materials set status = 'APPROVED' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.grinders (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Grinder 1');
insert into public.outlet_equipment (outlet_id, grinder_id)
  select id, '00000000-0000-0000-0000-0000000000a1' from public.outlets where code = 'JB-BROOOS';

grant select on all tables in schema public to authenticated;
set local role authenticated;

-- Barista: Black Hot first, then Milk Hot added to the same session, then Black Hot updated.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
declare
  v_outlet uuid := (select id from public.outlets where code = 'JB-BROOOS');
  v_session uuid := '00000000-0000-0000-0000-0000000005e1';
  v_rec jsonb;
  v_first uuid;
begin
  v_rec := jsonb_build_object('purpose', 'DAILY', 'outlet_id', v_outlet, 'business_date', public.my_business_date(),
                              'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                              'grinder_id', '00000000-0000-0000-0000-0000000000a1', 'grind_setting', '12',
                              'dose_g', 18, 'yield_g', 36, 'extraction_time_seconds', 28);
  v_first := (public.save_espresso_calibrations(jsonb_build_array(
    jsonb_build_object('record', v_rec || jsonb_build_object('session_id', v_session), 'uses', jsonb_build_array('BLACK_HOT')))))[1];
  assert (select session_id from public.calibrations where id = v_first) = v_session, 'client session id kept';

  perform public.edit_espresso_calibrations(v_session, '[]',
    jsonb_build_array(jsonb_build_object('record', v_rec || '{"yield_g": 40}', 'uses', jsonb_build_array('MILK_HOT'))));
  assert (select count(*) from public.calibrations where session_id = v_session) = 2, 'second tab joins the session';

  perform public.edit_espresso_calibrations(v_session,
    jsonb_build_array(jsonb_build_object('id', v_first, 'revision', (select revision from public.calibrations where id = v_first),
                                         'record', v_rec || '{"yield_g": 38}')), '[]');
  assert (select yield_g from public.calibrations where id = v_first) = 38, 'Black Hot updated in place';

  -- Another save of the same bean today (its own session).
  perform public.save_espresso_calibrations(jsonb_build_array(
    jsonb_build_object('record', v_rec || '{"grind_setting": "13"}', 'uses', jsonb_build_array('BLACK_ICED'))));
end;
$$;

-- Manager back-fills a Daily calibration 3 days ago, one tab at a time.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
declare
  v_outlet uuid := (select id from public.outlets where code = 'JB-BROOOS');
  v_session uuid := '00000000-0000-0000-0000-0000000005e2';
  v_rec jsonb;
begin
  v_rec := jsonb_build_object('purpose', 'DAILY', 'outlet_id', v_outlet, 'business_date', public.my_business_date() - 3,
                              'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                              'grinder_id', '00000000-0000-0000-0000-0000000000a1', 'grind_setting', '12',
                              'dose_g', 18, 'yield_g', 36, 'extraction_time_seconds', 28, 'session_id', v_session);
  perform public.save_espresso_calibrations(jsonb_build_array(jsonb_build_object('record', v_rec, 'uses', jsonb_build_array('BLACK_HOT'))));
  perform public.edit_espresso_calibrations(v_session, '[]',
    jsonb_build_array(jsonb_build_object('record', v_rec, 'uses', jsonb_build_array('BLACK_ICED'))));
  assert (select count(*) from public.calibrations where session_id = v_session) = 2, 'back-filled session takes a second tab';
end;
$$;

-- Survey of the first save: any of its drinks, but not a drink only in another save.
do $$
declare
  v_outlet uuid := (select id from public.outlets where code = 'JB-BROOOS');
  v_first uuid := (select id from public.calibrations where session_id = '00000000-0000-0000-0000-0000000005e1'
                    order by created_at, id limit 1);
begin
  insert into public.surveys (subject_type, calibration_id, outlet_ids, audience, drinks)
  values ('ESPRESSO', v_first, array[v_outlet], 'PUBLIC', array['BLACK_HOT', 'MILK_HOT']);
  begin
    insert into public.surveys (subject_type, calibration_id, outlet_ids, audience, drinks)
    values ('ESPRESSO', v_first, array[v_outlet], 'PUBLIC', array['BLACK_ICED']);
    raise exception 'a drink of another save should fail';
  exception when check_violation then
    null;
  end;
end;
$$;

rollback;
