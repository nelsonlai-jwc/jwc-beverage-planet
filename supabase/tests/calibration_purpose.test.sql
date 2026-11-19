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
insert into public.grinders (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Grinder 1');
insert into public.outlet_equipment (outlet_id, grinder_id)
  select id, '00000000-0000-0000-0000-0000000000a1' from public.outlets where code = 'JB-BROOOS';
insert into public.grinders (id, name) values ('00000000-0000-0000-0000-0000000000a3', 'Elsewhere');
insert into public.outlet_equipment (outlet_id, grinder_id)
  select id, '00000000-0000-0000-0000-0000000000a3' from public.outlets where code = 'JB-YOUBAR';
insert into public.brewers (id, name) values ('00000000-0000-0000-0000-0000000000d1', 'V60');
insert into public.outlet_equipment (outlet_id, brewer_id)
  select id, '00000000-0000-0000-0000-0000000000d1' from public.outlets where code = 'JB-YOUBAR';

grant select on all tables in schema public to authenticated;
set local role authenticated;

-- Barista: a daily record with two drinks, then custom records with any equipment.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
declare
  v_outlet uuid := (select id from public.outlets where code = 'JB-BROOOS');
  v_daily uuid;
  v_custom uuid;
  v_rev integer;
begin
  v_daily := public.save_espresso_calibration(null, null,
    jsonb_build_object('outlet_id', v_outlet, 'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                       'grinder_id', '00000000-0000-0000-0000-0000000000a1', 'grind_setting', '12'),
    '[{"drink_type":"BLACK_HOT","dose_g":18,"yield_g":36,"extraction_time_seconds":28},
      {"drink_type":"MILK_HOT","dose_g":18,"yield_g":32,"extraction_time_seconds":25,"taste_balance":"BALANCED"}]');
  assert (select count(*) from public.calibration_drinks where calibration_id = v_daily) = 2, 'two drinks';

  -- No drinks is refused.
  begin
    perform public.save_espresso_calibration(null, null,
      jsonb_build_object('purpose', 'CUSTOM', 'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                         'grinder_name', 'Home grinder', 'grind_setting', '5'), '[]');
    raise exception 'no drinks should fail';
  exception when check_violation then
    null;
  end;

  -- Edit replaces drinks; the history keeps the old ones; a stale revision is refused.
  v_rev := (select revision from public.calibrations where id = v_daily);
  perform public.save_espresso_calibration(v_daily, v_rev,
    jsonb_build_object('outlet_id', v_outlet, 'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                       'grinder_id', '00000000-0000-0000-0000-0000000000a1', 'grind_setting', '11'),
    '[{"drink_type":"BLACK_ICED","dose_g":20,"yield_g":40,"extraction_time_seconds":30}]');
  assert (select string_agg(drink_type, ',') from public.calibration_drinks where calibration_id = v_daily) = 'BLACK_ICED',
    'drinks replaced';
  begin
    perform public.save_espresso_calibration(v_daily, v_rev,
      jsonb_build_object('outlet_id', v_outlet, 'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                         'grinder_id', '00000000-0000-0000-0000-0000000000a1', 'grind_setting', '10'),
      '[{"drink_type":"BLACK_HOT","dose_g":18,"yield_g":36,"extraction_time_seconds":28}]');
    raise exception 'stale revision should fail';
  exception when serialization_failure then
    null;
  end;

  -- Custom: typed grinder name, and a grinder of an outlet the barista is not in; two a day.
  v_custom := public.save_espresso_calibration(null, null,
    jsonb_build_object('purpose', 'CUSTOM', 'business_date', public.my_business_date() - 30,
                       'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                       'grinder_name', 'Home grinder', 'machine_name', 'Home machine', 'grind_setting', '5'),
    '[{"drink_type":"BLACK_HOT","dose_g":18,"yield_g":36,"extraction_time_seconds":28}]');
  perform public.save_espresso_calibration(null, null,
    jsonb_build_object('purpose', 'CUSTOM', 'business_date', public.my_business_date() - 30,
                       'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                       'grinder_id', '00000000-0000-0000-0000-0000000000a3', 'grind_setting', '6'),
    '[{"drink_type":"MILK_ICED","dose_g":18,"yield_g":36,"extraction_time_seconds":28}]');
  -- Both a grinder and a typed name is refused.
  begin
    perform public.save_espresso_calibration(null, null,
      jsonb_build_object('purpose', 'CUSTOM', 'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                         'grinder_id', '00000000-0000-0000-0000-0000000000a3', 'grinder_name', 'x', 'grind_setting', '6'),
      '[{"drink_type":"MILK_ICED","dose_g":18,"yield_g":36,"extraction_time_seconds":28}]');
    raise exception 'grinder and name both should fail';
  exception when check_violation then
    null;
  end;
  -- The creator deletes a custom record (no Manager needed).
  update public.calibrations set deleted_at = now(), delete_reason = 'test' where id = v_custom;

  insert into public.calibration_shots (purpose, coffee_bean_material_id, grinder_name, drink_type,
                                        dose_g, yield_g, extraction_time_seconds, grind_setting)
  values ('CUSTOM', '00000000-0000-0000-0000-0000000000b1', 'Home grinder', 'BLACK_HOT', 18, 40, 22, '5');

  insert into public.filter_calibrations (purpose, coffee_bean_material_id, brewer_id, grinder_name,
                                          grind_setting, dose_g, water_g, total_time_seconds)
  values ('CUSTOM', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1',
          'Home grinder', '20', 15, 250, 180);
  insert into public.filter_calibration_brews (purpose, coffee_bean_material_id, brewer_name, grinder_name,
                                               grind_setting, dose_g, water_g, total_time_seconds)
  values ('CUSTOM', '00000000-0000-0000-0000-0000000000b1', 'Kalita', 'Home grinder', '20', 15, 250, 180);
end;
$$;

-- Manager of the outlet sees the daily record but none of the barista's custom ones.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  assert (select count(*) from public.calibrations) = 1, 'manager sees daily only';
  assert (select count(*) from public.calibration_drinks) = 1, 'manager sees daily drinks only';
  assert (select count(*) from public.calibration_shots) = 0, 'no custom shots';
  assert (select count(*) from public.filter_calibrations) = 0, 'no custom filter';
end;
$$;

-- Super Admin sees custom records but cannot change them.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
begin
  assert (select count(*) from public.calibrations where purpose = 'CUSTOM') = 2, 'admin sees custom';
  assert (select count(*) from public.filter_calibration_brews where purpose = 'CUSTOM') = 1, 'admin sees custom brews';
  update public.calibrations set grind_setting = '9' where purpose = 'CUSTOM';
  assert not exists (select 1 from public.calibrations where grind_setting = '9'), 'admin cannot edit custom';
end;
$$;

rollback;
