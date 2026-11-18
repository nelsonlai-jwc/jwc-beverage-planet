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
insert into public.materials (id, name, brand, material_type_id, created_by, is_coffee_bean)
  select '00000000-0000-0000-0000-0000000000b1', 'Test Bean', 'Test', id,
         '00000000-0000-0000-0000-00000000000b', true
    from public.material_types where name = 'Other';
update public.materials set status = 'APPROVED' where id = '00000000-0000-0000-0000-0000000000b1';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  begin
    insert into public.brewers (outlet_id, name) select id, 'V60' from public.outlets where code = 'JB-BROOOS';
    raise exception 'manager should not add a brewer';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
insert into public.grinders (id, outlet_id, name)
  select '00000000-0000-0000-0000-0000000000a1', id, 'EK43' from public.outlets where code = 'JB-BROOOS';
insert into public.brewers (id, outlet_id, name, brewer_type)
  select '00000000-0000-0000-0000-0000000000d1', id, 'V60', 'POUR_OVER' from public.outlets where code = 'JB-BROOOS';
insert into public.brewers (id, outlet_id, name, brewer_type)
  select '00000000-0000-0000-0000-0000000000d2', id, 'Batch', 'BATCH' from public.outlets where code = 'JB-BROOOS';
insert into public.brewers (id, outlet_id, name)
  select '00000000-0000-0000-0000-0000000000d3', id, 'Elsewhere' from public.outlets where code = 'JB-YOUBAR';

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
  begin
    insert into public.filter_calibrations (outlet_id, coffee_bean_material_id, brewer_id, grinder_id, grind_setting,
                                            dose_g, water_g, total_time_seconds)
    values (v_outlet, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1',
            '00000000-0000-0000-0000-0000000000a1', '9', 15, 250, 165);
    raise exception 'same bean and brewer twice should fail';
  exception when unique_violation then
    null;
  end;
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
     where brewer_id = '00000000-0000-0000-0000-0000000000d2';
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
   where brewer_id = '00000000-0000-0000-0000-0000000000d2';
  assert (select deleted_by from public.filter_calibrations where brewer_id = '00000000-0000-0000-0000-0000000000d2')
    = '00000000-0000-0000-0000-00000000000b', 'manager deletes with reason';
end;
$$;

rollback;
