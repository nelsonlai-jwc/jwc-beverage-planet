-- Raw materials: Espresso / Filter calibration use only on type "Coffee Bean".
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000b', 'manager@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local', 'TEST MANAGER', 'MANAGER');
insert into public.material_types (name, sort_order) values ('Coffee Bean', 99) on conflict (name) do nothing;

-- A Coffee Bean may be used in either calibration; is_coffee_bean follows.
insert into public.materials (id, name, brand, material_type_id, created_by, espresso_calibration, filter_calibration)
  select '00000000-0000-0000-0000-0000000000d1', 'Filter Bean', 'Test', id,
         '00000000-0000-0000-0000-00000000000b', false, true
    from public.material_types where name = 'Coffee Bean';
do $$
begin
  if (select row(espresso_calibration, filter_calibration, is_coffee_bean)::text from public.materials
       where id = '00000000-0000-0000-0000-0000000000d1') <> '(f,t,t)' then
    raise exception 'coffee bean should keep filter use';
  end if;
end;
$$;

-- Any other type saves both as off.
insert into public.materials (id, name, brand, material_type_id, created_by, espresso_calibration, filter_calibration)
  select '00000000-0000-0000-0000-0000000000d2', 'Syrup Thing', 'Test', id,
         '00000000-0000-0000-0000-00000000000b', true, true
    from public.material_types where name = 'Other';
do $$
begin
  if (select row(espresso_calibration, filter_calibration, is_coffee_bean)::text from public.materials
       where id = '00000000-0000-0000-0000-0000000000d2') <> '(f,f,f)' then
    raise exception 'non coffee bean must not be used in calibration';
  end if;
end;
$$;

-- Changing a bean to another type clears both.
update public.materials set material_type_id = (select id from public.material_types where name = 'Other')
 where id = '00000000-0000-0000-0000-0000000000d1';
do $$
begin
  if (select row(espresso_calibration, filter_calibration, is_coffee_bean)::text from public.materials
       where id = '00000000-0000-0000-0000-0000000000d1') <> '(f,f,f)' then
    raise exception 'type change should clear calibration use';
  end if;
end;
$$;

rollback;
