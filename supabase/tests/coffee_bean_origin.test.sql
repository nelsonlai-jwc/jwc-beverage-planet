-- Coffee Bean origin / variety / process: kept only on type "Coffee Bean".
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000b', 'manager@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local', 'TEST MANAGER', 'MANAGER');
insert into public.material_types (name, sort_order) values ('Coffee Bean', 99) on conflict (name) do nothing;

-- Preset lists are seeded.
do $$
begin
  if (select count(*) from public.coffee_bean_options where kind = 'ORIGIN') < 40
     or (select count(*) from public.coffee_bean_options where kind = 'VARIETY') < 40
     or (select count(*) from public.coffee_bean_options where kind = 'PROCESS') < 20 then
    raise exception 'preset lists missing';
  end if;
end;
$$;

-- A Coffee Bean keeps them (trimmed; blank becomes empty).
insert into public.materials (id, name, brand, material_type_id, created_by, origin, variety, process)
  select '00000000-0000-0000-0000-0000000000e1', 'Origin Bean', 'Test', id,
         '00000000-0000-0000-0000-00000000000b', ' Ethiopia ', 'Gesha', '  '
    from public.material_types where name = 'Coffee Bean';
do $$
begin
  if (select row(origin, variety, process)::text from public.materials
       where id = '00000000-0000-0000-0000-0000000000e1') <> '(Ethiopia,Gesha,)' then
    raise exception 'coffee bean should keep origin and variety';
  end if;
end;
$$;

-- Any other type saves them as empty.
insert into public.materials (id, name, brand, material_type_id, created_by, origin, variety, process)
  select '00000000-0000-0000-0000-0000000000e2', 'Syrup Origin', 'Test', id,
         '00000000-0000-0000-0000-00000000000b', 'Kenya', 'SL28', 'Washed'
    from public.material_types where name = 'Other';
do $$
begin
  if (select row(origin, variety, process)::text from public.materials
       where id = '00000000-0000-0000-0000-0000000000e2') <> '(,,)' then
    raise exception 'non coffee bean must not keep origin';
  end if;
end;
$$;

-- Changing a bean to another type clears them.
update public.materials set material_type_id = (select id from public.material_types where name = 'Other')
 where id = '00000000-0000-0000-0000-0000000000e1';
do $$
begin
  if (select row(origin, variety, process)::text from public.materials
       where id = '00000000-0000-0000-0000-0000000000e1') <> '(,,)' then
    raise exception 'type change should clear origin';
  end if;
end;
$$;

-- Edits of approved materials may change them.
do $$
begin
  if not ('origin' = any (private.editable_fields('MATERIAL'))) then
    raise exception 'origin should be editable';
  end if;
end;
$$;

rollback;
