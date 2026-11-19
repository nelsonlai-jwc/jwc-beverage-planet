-- Daily calibration with grinders and machines, bean targets and test shots.
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

set local role authenticated;

-- Manager cannot add equipment.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  begin
    insert into public.grinders (name) values ('G');
    raise exception 'manager should not add a grinder';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

-- Super Admin adds two grinders and a machine at Brooos, and one grinder elsewhere.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
insert into public.grinders (id, name, brand, model, burr_type, scale_min, scale_max) values ('00000000-0000-0000-0000-0000000000a1', 'Grinder 1', 'Mahlkönig', 'E65S', 'FLAT', 1, 40);
insert into public.outlet_equipment (outlet_id, grinder_id)
  select id, '00000000-0000-0000-0000-0000000000a1' from public.outlets where code = 'JB-BROOOS';
insert into public.grinders (id, name) values ('00000000-0000-0000-0000-0000000000a2', 'Grinder 2');
insert into public.outlet_equipment (outlet_id, grinder_id)
  select id, '00000000-0000-0000-0000-0000000000a2' from public.outlets where code = 'JB-BROOOS';
insert into public.grinders (id, name) values ('00000000-0000-0000-0000-0000000000a3', 'Other outlet');
insert into public.outlet_equipment (outlet_id, grinder_id)
  select id, '00000000-0000-0000-0000-0000000000a3' from public.outlets where code = 'JB-YOUBAR';
insert into public.espresso_machines (id, name, brand, group_count, default_water_temp_c, default_pressure_bar) values ('00000000-0000-0000-0000-0000000000e1', 'Machine 1', 'La Marzocco', 2, 93, 9);
insert into public.outlet_equipment (outlet_id, espresso_machine_id)
  select id, '00000000-0000-0000-0000-0000000000e1' from public.outlets where code = 'JB-BROOOS';
do $$
begin
  begin
    insert into public.grinders (name, scale_min, scale_max) values ('Bad scale', 10, 5);
    raise exception 'scale min must be below max';
  exception when check_violation then
    null;
  end;
end;
$$;

-- Barista records the same bean on both grinders today; one per grinder only.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
declare
  v_outlet uuid := (select id from public.outlets where code = 'JB-BROOOS');
  v_count integer;
begin
  insert into public.calibrations (outlet_id, coffee_bean_material_id, grinder_id, espresso_machine_id,
                                   grind_setting, water_temp_c, pressure_bar, roast_date)
  values (v_outlet, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-0000000000e1', '12', 93, 9, public.my_business_date() - 10);
  insert into public.calibrations (outlet_id, coffee_bean_material_id, grinder_id,
                                   grind_setting)
  values (v_outlet, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2', '3.5');
  begin
    insert into public.calibrations (outlet_id, coffee_bean_material_id, grinder_id, grind_setting)
    values (v_outlet, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '13');
    raise exception 'same bean and grinder twice a day should fail';
  exception when unique_violation then
    null;
  end;
  -- A grinder of another outlet cannot be used.
  begin
    insert into public.calibrations (outlet_id, coffee_bean_material_id, grinder_id, grind_setting)
    values (v_outlet, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3', '13');
    raise exception 'grinder of another outlet should fail';
  exception when check_violation then
    null;
  end;
  -- Roast date after the business date is refused.
  begin
    update public.calibrations set roast_date = public.my_business_date() + 1
     where grinder_id = '00000000-0000-0000-0000-0000000000a2';
    raise exception 'future roast date should fail';
  exception when check_violation then
    null;
  end;
  -- The grinder of a record cannot change.
  begin
    update public.calibrations set grinder_id = '00000000-0000-0000-0000-0000000000a1'
     where grinder_id = '00000000-0000-0000-0000-0000000000a2';
    raise exception 'grinder change should fail';
  exception when check_violation then
    null;
  end;

  -- Test shots: insert only, never changed.
  insert into public.calibration_shots (outlet_id, coffee_bean_material_id, grinder_id, drink_type,
                                        dose_g, yield_g, extraction_time_seconds, grind_setting, taste_balance)
  values (v_outlet, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'BLACK_HOT',
          18, 40, 22, '14', 'SOUR');
  begin
    update public.calibration_shots set dose_g = 19;
    raise exception 'shots should not be updated';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.calibration_shots (outlet_id, business_date, coffee_bean_material_id, grinder_id, drink_type,
                                          dose_g, yield_g, extraction_time_seconds, grind_setting)
    values (v_outlet, public.my_business_date() - 1, '00000000-0000-0000-0000-0000000000b1',
            '00000000-0000-0000-0000-0000000000a1', 'BLACK_HOT', 18, 40, 22, '14');
    raise exception 'barista shots are for today only';
  exception when insufficient_privilege then
    null;
  end;

  -- Barista cannot set bean targets.
  begin
    insert into public.coffee_bean_targets (material_id, drink_type, dose_min_g, dose_max_g, yield_min_g, yield_max_g,
                                            time_min_seconds, time_max_seconds)
    values ('00000000-0000-0000-0000-0000000000b1', 'BLACK_HOT', 18, 18.5, 36, 40, 25, 32);
    raise exception 'barista should not set targets';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

-- Manager sets bean targets; a disabled grinder is no longer offered for new records.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
insert into public.coffee_bean_targets (material_id, drink_type, dose_min_g, dose_max_g, yield_min_g, yield_max_g,
                                        time_min_seconds, time_max_seconds)
values ('00000000-0000-0000-0000-0000000000b1', 'BLACK_HOT', 18, 18.5, 36, 40, 25, 32);
do $$
begin
  assert (select updated_by from public.coffee_bean_targets) = '00000000-0000-0000-0000-00000000000b',
    'target saved by manager';
  begin
    update public.coffee_bean_targets set time_max_seconds = 20;
    raise exception 'max below min should fail';
  exception when check_violation then
    null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
update public.grinders set is_active = false where id = '00000000-0000-0000-0000-0000000000a2';
do $$
begin
  -- Existing record on the disabled grinder can still be edited.
  update public.calibrations set grind_setting = '4' where grinder_id = '00000000-0000-0000-0000-0000000000a2';
  assert (select grind_setting from public.calibrations where grinder_id = '00000000-0000-0000-0000-0000000000a2') = '4',
    'edit on disabled grinder';
  begin
    insert into public.calibration_shots (outlet_id, coffee_bean_material_id, grinder_id, drink_type,
                                          dose_g, yield_g, extraction_time_seconds, grind_setting)
    select id, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a2', 'BLACK_HOT', 18, 36, 28, '3'
      from public.outlets where code = 'JB-BROOOS';
    raise exception 'disabled grinder should fail';
  exception when check_violation then
    null;
  end;
end;
$$;

rollback;
