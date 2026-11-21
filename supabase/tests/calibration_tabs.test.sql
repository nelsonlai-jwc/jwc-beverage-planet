-- Calibration tabs: several Finals in one save (all or none), test shots / brews per tab.
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
  v_ids uuid[];
  v_old uuid;
begin
  v_rec := jsonb_build_object('outlet_id', v_outlet, 'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                              'grinder_id', '00000000-0000-0000-0000-0000000000a1', 'grind_setting', '12',
                              'dose_g', 18, 'yield_g', 36, 'extraction_time_seconds', 28);

  -- Two tabs: two Finals, one drink each, with their own values.
  v_ids := public.save_espresso_calibrations(jsonb_build_array(
    jsonb_build_object('record', v_rec, 'uses', jsonb_build_array('BLACK_HOT')),
    jsonb_build_object('record', v_rec || '{"yield_g": 40}', 'uses', jsonb_build_array('MILK_HOT'))));
  assert cardinality(v_ids) = 2, 'two finals';
  assert (select yield_g from public.calibrations c join public.calibration_drinks d on d.calibration_id = c.id
           where d.drink_type = 'MILK_HOT') = 40, 'white hot keeps its own yield';

  -- All or none: the second tab would replace without agreement, so the first is not saved either.
  begin
    perform public.save_espresso_calibrations(jsonb_build_array(
      jsonb_build_object('record', v_rec, 'uses', jsonb_build_array('BLACK_ICED')),
      jsonb_build_object('record', v_rec, 'uses', jsonb_build_array('MILK_HOT'))));
    raise exception 'replacing without agreeing should fail';
  exception when serialization_failure then
    null;
  end;
  assert not exists (select 1 from public.calibration_drinks where drink_type = 'BLACK_ICED'), 'nothing saved';

  -- With agreement it replaces only that drink.
  v_old := (select id from public.calibration_drinks where drink_type = 'MILK_HOT');
  perform public.save_espresso_calibrations(jsonb_build_array(
    jsonb_build_object('record', v_rec, 'uses', jsonb_build_array('MILK_HOT'), 'replace', jsonb_build_array(v_old))));
  assert (select superseded_by is not null from public.calibration_drinks where id = v_old), 'old white hot replaced';

  -- Empty list refused.
  begin
    perform public.save_espresso_calibrations('[]');
    raise exception 'empty should fail';
  exception when check_violation then
    null;
  end;

  -- Test shot of one tab.
  insert into public.calibration_shots (purpose, outlet_id, business_date, coffee_bean_material_id, grinder_id,
                                        grind_setting, dose_g, yield_g, extraction_time_seconds, drink_type)
  values ('DAILY', v_outlet, public.my_business_date(), '00000000-0000-0000-0000-0000000000b1',
          '00000000-0000-0000-0000-0000000000a1', '12', 18, 36, 28, 'BLACK_ICED');
  begin
    insert into public.calibration_shots (purpose, outlet_id, business_date, coffee_bean_material_id, grinder_id,
                                          grind_setting, dose_g, yield_g, extraction_time_seconds, drink_type)
    values ('DAILY', v_outlet, public.my_business_date(), '00000000-0000-0000-0000-0000000000b1',
            '00000000-0000-0000-0000-0000000000a1', '12', 18, 36, 28, 'LATTE');
    raise exception 'unknown drink should fail';
  exception when check_violation then
    null;
  end;
end;
$$;

-- Filter: Hot and Iced tabs as two Finals; a test brew of the Iced tab.
do $$
declare
  v_rec jsonb;
  v_ids uuid[];
begin
  v_rec := jsonb_build_object('purpose', 'CUSTOM', 'coffee_bean_material_id', '00000000-0000-0000-0000-0000000000b1',
                              'grinder_name', 'Hand grinder', 'brewer_name', 'Kalita', 'grind_setting', '20',
                              'dose_g', 15, 'water_g', 250, 'total_time_seconds', 180);
  v_ids := public.save_filter_calibrations(jsonb_build_array(
    jsonb_build_object('record', v_rec, 'uses', jsonb_build_array('HOT')),
    jsonb_build_object('record', v_rec || '{"water_g": 150}', 'uses', jsonb_build_array('ICED'))));
  assert cardinality(v_ids) = 2, 'two filter finals';
  assert (select water_g from public.filter_calibrations f join public.filter_calibration_uses u on u.filter_calibration_id = f.id
           where u.temperature = 'ICED') = 150, 'iced keeps its own water';
  insert into public.filter_calibration_brews (purpose, business_date, coffee_bean_material_id, grinder_name, brewer_name,
                                               grind_setting, dose_g, water_g, total_time_seconds, temperature)
  values ('CUSTOM', public.my_business_date(), '00000000-0000-0000-0000-0000000000b1', 'Hand grinder', 'Kalita',
          '20', 15, 150, 180, 'ICED');
end;
$$;

rollback;
