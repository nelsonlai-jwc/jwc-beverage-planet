-- Filter calibration: brewers, one record per outlet/day/bean/brewer, test brews, targets.
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

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  begin
    insert into public.brewers (name) values ('V60');
    raise exception 'manager should not add a brewer';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
insert into public.grinders (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'EK43');
insert into public.outlet_equipment (outlet_id, grinder_id)
  select id, '00000000-0000-0000-0000-0000000000a1' from public.outlets where code = 'JB-BROOOS';
insert into public.brewers (id, name, brewer_type) values ('00000000-0000-0000-0000-0000000000d1', 'V60', 'POUR_OVER');
insert into public.outlet_equipment (outlet_id, brewer_id)
  select id, '00000000-0000-0000-0000-0000000000d1' from public.outlets where code = 'JB-BROOOS';
insert into public.brewers (id, name, brewer_type) values ('00000000-0000-0000-0000-0000000000d2', 'Batch', 'BATCH');
insert into public.outlet_equipment (outlet_id, brewer_id)
  select id, '00000000-0000-0000-0000-0000000000d2' from public.outlets where code = 'JB-BROOOS';
insert into public.brewers (id, name) values ('00000000-0000-0000-0000-0000000000d3', 'Elsewhere');
insert into public.outlet_equipment (outlet_id, brewer_id)
  select id, '00000000-0000-0000-0000-0000000000d3' from public.outlets where code = 'JB-YOUBAR';

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
declare
  v_outlet uuid := (select id from public.outlets where code = 'JB-BROOOS');
begin
  -- Same bean on V60 and batch brewer the same day.
  insert into public.filter_calibrations (outlet_id, coffee_bean_material_id, brewer_id, grinder_id, grind_setting,
                                          dose_g, water_g, total_time_seconds, tds_percent, beverage_g)
  values (v_outlet, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1',
          '00000000-0000-0000-0000-0000000000a1', '9', 15, 250, 165, 1.35, 215);
  insert into public.filter_calibrations (outlet_id, coffee_bean_material_id, brewer_id, grinder_id, grind_setting,
                                          dose_g, water_g, total_time_seconds)
  values (v_outlet, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d2',
          '00000000-0000-0000-0000-0000000000a1', '10', 60, 1000, 300);
  -- One current Final per bean, grinder and hot / iced: a second Hot needs agreement.
  perform public.save_filter_calibration(jsonb_build_object('outlet_id', v_outlet,
    'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1', 'brewer_id', '00000000-0000-0000-0000-0000000000d1',
    'grinder_id', '00000000-0000-0000-0000-0000000000a1', 'grind_setting', '9', 'dose_g', 15, 'water_g', 250,
    'total_time_seconds', 165), array['HOT'], null);
  begin
    perform public.save_filter_calibration(jsonb_build_object('outlet_id', v_outlet,
      'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1', 'brewer_id', '00000000-0000-0000-0000-0000000000d2',
      'grinder_id', '00000000-0000-0000-0000-0000000000a1', 'grind_setting', '9', 'dose_g', 15, 'water_g', 250,
      'total_time_seconds', 165), array['HOT', 'ICED'], null);
    raise exception 'same bean, grinder and hot twice should need agreement';
  exception when serialization_failure then
    null;
  end;
  perform public.save_filter_calibration(jsonb_build_object('outlet_id', v_outlet,
    'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1', 'brewer_id', '00000000-0000-0000-0000-0000000000d2',
    'grinder_id', '00000000-0000-0000-0000-0000000000a1', 'grind_setting', '9', 'dose_g', 15, 'water_g', 250,
    'total_time_seconds', 165), array['ICED'], null);
  assert (select count(*) from public.filter_calibration_uses where superseded_by is null) = 2, 'hot and iced current';
  begin
    insert into public.filter_calibrations (outlet_id, coffee_bean_material_id, brewer_id, grinder_id, grind_setting,
                                            dose_g, water_g, total_time_seconds)
    values (v_outlet, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d3',
            '00000000-0000-0000-0000-0000000000a1', '9', 15, 250, 165);
    raise exception 'brewer of another outlet should fail';
  exception when check_violation then
    null;
  end;
  begin
    update public.filter_calibrations set deleted_at = now(), delete_reason = 'x'
     where brewer_id = '00000000-0000-0000-0000-0000000000d2' and grind_setting = '10';
    raise exception 'barista should not delete';
  exception when insufficient_privilege then
    null;
  end;
  insert into public.filter_calibration_brews (outlet_id, coffee_bean_material_id, brewer_id, grinder_id,
                                               grind_setting, dose_g, water_g, total_time_seconds)
  values (v_outlet, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1',
          '00000000-0000-0000-0000-0000000000a1', '8', 15, 250, 190);
  begin
    insert into public.filter_calibration_brews (outlet_id, business_date, coffee_bean_material_id, brewer_id,
                                                 grinder_id, grind_setting, dose_g, water_g, total_time_seconds)
    values (v_outlet, public.my_business_date() - 1, '00000000-0000-0000-0000-0000000000b1',
            '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '8', 15, 250, 190);
    raise exception 'barista brews are today only';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.coffee_bean_filter_targets (material_id, dose_min_g, dose_max_g, ratio_min, ratio_max,
                                                   time_min_seconds, time_max_seconds)
    values ('00000000-0000-0000-0000-0000000000b1', 15, 16, 15, 17, 150, 210);
    raise exception 'barista should not set targets';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
insert into public.coffee_bean_filter_targets (material_id, dose_min_g, dose_max_g, ratio_min, ratio_max,
                                               time_min_seconds, time_max_seconds)
values ('00000000-0000-0000-0000-0000000000b1', 15, 16, 15, 17, 150, 210);
do $$
begin
  update public.filter_calibrations set deleted_at = now(), delete_reason = 'wrong'
   where brewer_id = '00000000-0000-0000-0000-0000000000d2' and grind_setting = '10';
  assert (select deleted_by from public.filter_calibrations
           where brewer_id = '00000000-0000-0000-0000-0000000000d2' and grind_setting = '10')
    = '00000000-0000-0000-0000-00000000000b', 'manager deletes with reason';
end;
$$;

rollback;
