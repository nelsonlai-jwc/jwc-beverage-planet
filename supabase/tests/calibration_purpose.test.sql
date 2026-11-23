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

insert into public.material_types (name, sort_order) values ('Coffee Bean', 99) on conflict (name) do nothing;
insert into public.materials (id, name, brand, material_type_id, created_by, espresso_calibration, filter_calibration)
  select '00000000-0000-0000-0000-0000000000b1', 'Test Bean', 'Test', id,
         '00000000-0000-0000-0000-00000000000b', true, true
    from public.material_types where name = 'Coffee Bean';
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

-- Barista: daily Finals with the one-current-Final rule, then custom records with any equipment.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
declare
  v_outlet uuid := (select id from public.outlets where code = 'JB-BROOOS');
  v_rec jsonb;
  v_daily uuid;
  v_second uuid;
  v_custom uuid;
  v_milk uuid;
begin
  v_rec := jsonb_build_object('outlet_id', v_outlet, 'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                              'grinder_id', '00000000-0000-0000-0000-0000000000a1', 'grind_setting', '12',
                              'dose_g', 18, 'yield_g', 36, 'extraction_time_seconds', 28, 'production_no', 'PR-47481');
  v_daily := public.save_espresso_calibration(v_rec, array['BLACK_HOT', 'MILK_HOT'], null);
  assert (select count(*) from public.calibration_drinks where calibration_id = v_daily) = 2, 'two drinks';

  -- No drinks ticked is refused.
  begin
    perform public.save_espresso_calibration(v_rec, '{}', null);
    raise exception 'no drinks should fail';
  exception when check_violation then
    null;
  end;
  -- Wrong production number format is refused.
  begin
    perform public.save_espresso_calibration(v_rec || '{"production_no":"PR-4748"}', array['BLACK_ICED'], null);
    raise exception 'bad production number should fail';
  exception when check_violation then
    null;
  end;
  -- A Final for White hot exists: saving without agreeing to replace it is refused.
  begin
    perform public.save_espresso_calibration(v_rec, array['MILK_HOT', 'MILK_ICED'], null);
    raise exception 'replacing without agreeing should fail';
  exception when serialization_failure then
    null;
  end;
  -- Agreeing to replace it: only White hot moves to the new Final; Black hot stays.
  v_milk := (select id from public.calibration_drinks where calibration_id = v_daily and drink_type = 'MILK_HOT');
  v_second := public.save_espresso_calibration(v_rec || '{"grind_setting":"11"}', array['MILK_HOT', 'MILK_ICED'],
                                               array[v_milk]);
  assert (select superseded_by from public.calibration_drinks where id = v_milk) = v_second, 'white hot replaced';
  assert (select superseded_by from public.calibration_drinks
           where calibration_id = v_daily and drink_type = 'BLACK_HOT') is null, 'black hot stays';
  -- Agreeing to replace something that is not current any more is refused too.
  begin
    perform public.save_espresso_calibration(v_rec, array['MILK_HOT'], array[v_milk]);
    raise exception 'stale replace should fail';
  exception when serialization_failure then
    null;
  end;
  -- The bean of a Final cannot be changed.
  begin
    update public.calibrations set coffee_bean_material_id = '00000000-0000-0000-0000-0000000000b2' where id = v_daily;
    raise exception 'bean change should fail';
  exception when check_violation then
    null;
  end;
  -- Its creator can edit today's Final through the session edit (2026-11-23).
  perform public.edit_espresso_calibrations(
    (select session_id from public.calibrations where id = v_daily),
    jsonb_build_array(jsonb_build_object('id', v_daily, 'revision', (select revision from public.calibrations where id = v_daily),
                                         'record', v_rec || '{"grind_setting":"10"}')),
    '[]');
  assert (select grind_setting from public.calibrations where id = v_daily) = '10', 'creator edit';

  -- Custom: typed grinder name, and a grinder of an outlet the barista is not in; no rule.
  v_custom := public.save_espresso_calibration(
    jsonb_build_object('purpose', 'CUSTOM', 'business_date', public.my_business_date() - 30,
                       'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                       'grinder_name', 'Home grinder', 'machine_name', 'Home machine', 'grind_setting', '5',
                       'dose_g', 18, 'yield_g', 36, 'extraction_time_seconds', 28),
    array['BLACK_HOT'], null);
  perform public.save_espresso_calibration(
    jsonb_build_object('purpose', 'CUSTOM', 'business_date', public.my_business_date() - 30,
                       'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                       'grinder_id', '00000000-0000-0000-0000-0000000000a3', 'grind_setting', '6',
                       'dose_g', 18, 'yield_g', 36, 'extraction_time_seconds', 28),
    array['BLACK_HOT'], null);
  perform public.save_espresso_calibration(
    jsonb_build_object('purpose', 'CUSTOM', 'business_date', public.my_business_date() - 30,
                       'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                       'grinder_id', '00000000-0000-0000-0000-0000000000a3', 'grind_setting', '7',
                       'dose_g', 18, 'yield_g', 36, 'extraction_time_seconds', 28),
    array['BLACK_HOT'], null);
  assert (select count(*) from public.calibrations where purpose = 'CUSTOM') = 3, 'custom: no rule';
  -- Both a grinder and a typed name is refused.
  begin
    perform public.save_espresso_calibration(
      jsonb_build_object('purpose', 'CUSTOM', 'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                         'grinder_id', '00000000-0000-0000-0000-0000000000a3', 'grinder_name', 'x', 'grind_setting', '6',
                         'dose_g', 18, 'yield_g', 36, 'extraction_time_seconds', 28),
      array['MILK_ICED'], null);
    raise exception 'grinder and name both should fail';
  exception when check_violation then
    null;
  end;
  -- The creator deletes a custom record (no Manager needed).
  update public.calibrations set deleted_at = now(), delete_reason = 'test' where id = v_custom;

  insert into public.calibration_shots (purpose, coffee_bean_material_id, grinder_name,
                                        dose_g, yield_g, extraction_time_seconds, grind_setting)
  values ('CUSTOM', '00000000-0000-0000-0000-0000000000b1', 'Home grinder', 18, 40, 22, '5');

  perform public.save_filter_calibration(
    jsonb_build_object('purpose', 'CUSTOM', 'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                       'brewer_id', '00000000-0000-0000-0000-0000000000d1', 'grinder_name', 'Home grinder',
                       'grind_setting', '20', 'dose_g', 15, 'water_g', 250, 'total_time_seconds', 180),
    array['HOT'], null);
  insert into public.filter_calibration_brews (purpose, coffee_bean_material_id, brewer_name, grinder_name,
                                               grind_setting, dose_g, water_g, total_time_seconds)
  values ('CUSTOM', '00000000-0000-0000-0000-0000000000b1', 'Kalita', 'Home grinder', '20', 15, 250, 180);
end;
$$;

-- Manager: a deleted Final stops counting; restoring it fails while a newer one is current.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
declare
  v_first uuid := (select calibration_id from public.calibration_drinks where drink_type = 'BLACK_HOT' and purpose = 'DAILY');
  v_second uuid := (select calibration_id from public.calibration_drinks where drink_type = 'MILK_ICED' and purpose = 'DAILY');
begin
  update public.calibrations set deleted_at = now(), delete_reason = 'wrong' where id = v_second;
  assert (select record_deleted from public.calibration_drinks where calibration_id = v_second limit 1), 'uses follow delete';
  perform public.save_espresso_calibration(
    jsonb_build_object('outlet_id', (select id from public.outlets where code = 'JB-BROOOS'),
                       'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                       'grinder_id', '00000000-0000-0000-0000-0000000000a1', 'grind_setting', '13',
                       'dose_g', 18, 'yield_g', 36, 'extraction_time_seconds', 28),
    array['MILK_ICED'], null);
  begin
    update public.calibrations set deleted_at = null, deleted_by = null, delete_reason = null where id = v_second;
    raise exception 'restore over a newer Final should fail';
  exception when unique_violation then
    null;
  end;
  assert v_first is not null, 'first daily';
end;
$$;

-- Manager of the outlet sees the daily record but none of the barista's custom ones.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  assert (select count(*) from public.calibrations where purpose = 'CUSTOM') = 0, 'manager sees daily only';
  assert (select count(*) from public.calibration_drinks where purpose = 'CUSTOM') = 0, 'manager sees daily drinks only';
  assert (select count(*) from public.calibration_shots) = 0, 'no custom shots';
  assert (select count(*) from public.filter_calibrations) = 0, 'no custom filter';
end;
$$;

-- Super Admin sees custom records and can edit them (2026-11-23), but cannot delete someone's.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
begin
  assert (select count(*) from public.calibrations where purpose = 'CUSTOM') = 3, 'admin sees custom';
  assert (select count(*) from public.filter_calibration_brews where purpose = 'CUSTOM') = 1, 'admin sees custom brews';
  update public.calibrations set grind_setting = '9' where purpose = 'CUSTOM' and deleted_at is null;
  assert (select count(*) from public.calibrations where grind_setting = '9') = 2, 'admin can edit custom';
  begin
    update public.calibrations set deleted_at = now(), delete_reason = 'x' where purpose = 'CUSTOM' and deleted_at is null;
    raise exception 'admin delete of custom should fail';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

rollback;
