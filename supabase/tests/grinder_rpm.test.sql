-- Grinder RPM: a grinder with adjustable speed has a range; calibration RPM must be inside it.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'manager@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@test.local', 'SUPER ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-0000000000b1', 'manager@test.local', 'MANAGER', 'MANAGER');
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000a1';
insert into public.user_outlets (user_id, outlet_id)
select '00000000-0000-0000-0000-0000000000b1'::uuid, id from public.outlets where code = 'JB-BROOOS';

insert into public.material_types (name, sort_order) values ('Coffee Bean', 99) on conflict (name) do nothing;
insert into public.materials (id, name, brand, material_type_id, created_by, espresso_calibration, filter_calibration)
  select '00000000-0000-0000-0000-0000000000c1', 'Test Bean', 'Test', id,
         '00000000-0000-0000-0000-0000000000b1', true, true
    from public.material_types where name = 'Coffee Bean';
update public.materials set status = 'APPROVED' where id = '00000000-0000-0000-0000-0000000000c1';

create temp table t_outlet as select code, id from public.outlets;
grant select on t_outlet to authenticated;
grant select on all tables in schema public to authenticated;

set local role authenticated;

-- Super Admin: one grinder with speed 600–1500, one without; a range needs the tick.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
insert into public.grinders (id, name, rpm_adjustable, rpm_min, rpm_max)
  values ('00000000-0000-0000-0000-0000000000d1', 'RPM grinder', true, 600, 1500);
insert into public.grinders (id, name) values ('00000000-0000-0000-0000-0000000000d3', 'Fixed grinder');
insert into public.brewers (id, name) values ('00000000-0000-0000-0000-0000000000d2', 'V60');
do $$
declare
  v_mine uuid := (select id from t_outlet where code = 'JB-BROOOS');
begin
  begin
    insert into public.grinders (name, rpm_adjustable) values ('No range', true);
    raise exception 'adjustable speed without a range should fail';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.grinders (name, rpm_min, rpm_max) values ('Range only', 600, 1500);
    raise exception 'a range without adjustable speed should fail';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.grinders (name, rpm_adjustable, rpm_min, rpm_max) values ('Backwards', true, 1500, 600);
    raise exception 'min above max should fail';
  exception when check_violation then
    null;
  end;
  insert into public.outlet_equipment (outlet_id, grinder_id) values (v_mine, '00000000-0000-0000-0000-0000000000d1');
  insert into public.outlet_equipment (outlet_id, grinder_id) values (v_mine, '00000000-0000-0000-0000-0000000000d3');
  insert into public.outlet_equipment (outlet_id, brewer_id) values (v_mine, '00000000-0000-0000-0000-0000000000d2');
end;
$$;

-- Manager records RPM: inside the range, blank, outside, and on a grinder without speed.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$
declare
  v_mine uuid := (select id from t_outlet where code = 'JB-BROOOS');
  v_id uuid;
begin
  v_id := public.save_espresso_calibration(jsonb_build_object(
    'outlet_id', v_mine, 'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000c1',
    'grinder_id', '00000000-0000-0000-0000-0000000000d1', 'grind_setting', '5', 'grinder_rpm', 1200, 'dose_g', 18, 'yield_g', 36, 'extraction_time_seconds', 28),
    array['BLACK_HOT'], null);
  assert (select grinder_rpm from public.calibrations where id = v_id) = 1200, 'RPM saved on the record';

  begin
    perform public.save_espresso_calibration(jsonb_build_object(
      'outlet_id', v_mine, 'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000c1',
      'grinder_id', '00000000-0000-0000-0000-0000000000d3', 'grind_setting', '5', 'grinder_rpm', 1200, 'dose_g', 18, 'yield_g', 36, 'extraction_time_seconds', 28),
    array['BLACK_HOT'], null);
    raise exception 'RPM on a grinder without adjustable speed should fail';
  exception when check_violation then
    null;
  end;

  insert into public.calibration_shots (outlet_id, coffee_bean_material_id, grinder_id, grind_setting, grinder_rpm,
                                        dose_g, yield_g, extraction_time_seconds)
  values (v_mine, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '5', 600,
          18, 36, 28);
  begin
    insert into public.calibration_shots (outlet_id, coffee_bean_material_id, grinder_id, grind_setting, grinder_rpm,
                                          dose_g, yield_g, extraction_time_seconds)
    values (v_mine, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '5', 1501,
            18, 36, 28);
    raise exception 'RPM above the range should fail';
  exception when check_violation then
    null;
  end;

  insert into public.filter_calibrations (outlet_id, coffee_bean_material_id, brewer_id, grinder_id, grind_setting,
                                          grinder_rpm, dose_g, water_g, total_time_seconds)
  values (v_mine, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d2',
          '00000000-0000-0000-0000-0000000000d1', '10', 900, 15, 250, 180);
  begin
    insert into public.filter_calibration_brews (outlet_id, coffee_bean_material_id, brewer_id, grinder_id,
                                                 grind_setting, grinder_rpm, dose_g, water_g, total_time_seconds)
    values (v_mine, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d2',
            '00000000-0000-0000-0000-0000000000d1', '10', 599, 15, 250, 180);
    raise exception 'RPM below the range should fail';
  exception when check_violation then
    null;
  end;
  -- Blank RPM is fine.
  insert into public.filter_calibration_brews (outlet_id, coffee_bean_material_id, brewer_id, grinder_id,
                                               grind_setting, dose_g, water_g, total_time_seconds)
  values (v_mine, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d2',
          '00000000-0000-0000-0000-0000000000d1', '10', 15, 250, 180);
end;
$$;

rollback;
