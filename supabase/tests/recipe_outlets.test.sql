-- Recipes for several outlets or all outlets: who sees, who edits, menus and Prep.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

-- Users: Admin; Manager M2 of JB-BROOOS + JB-YOUBAR; Manager M1 of JB-BROOOS only;
-- Manager MK of KL-CABINET8; Barista of JB-YOUBAR.
alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'm2@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'm1@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'mk@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'barista@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local', 'TEST ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-00000000000b', 'm2@test.local', 'MANAGER TWO', 'MANAGER'),
  ('00000000-0000-0000-0000-00000000000c', 'm1@test.local', 'MANAGER ONE', 'MANAGER'),
  ('00000000-0000-0000-0000-00000000000d', 'mk@test.local', 'MANAGER KL', 'MANAGER');
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000b', id from public.outlets where code in ('JB-BROOOS', 'JB-YOUBAR');
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000c', id from public.outlets where code = 'JB-BROOOS';
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000d', id from public.outlets where code = 'KL-CABINET8';
-- A Barista needs exactly one outlet in the same transaction as the profile.
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000e', 'barista@test.local', 'TEST BARISTA', 'BARISTA');
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000e', id from public.outlets where code = 'JB-YOUBAR';

set local role authenticated;

-- M2 creates a drink for both JB outlets ----------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
declare
  v_version uuid;
  v_recipe uuid;
begin
  v_version := public.create_recipe(
    (select array_agg(id) from public.outlets where code in ('JB-BROOOS', 'JB-YOUBAR')), false, false, 'Shared Latte');
  select recipe_id into v_recipe from public.recipe_versions where id = v_version;
  assert (select count(*) from public.recipe_outlets where recipe_id = v_recipe) = 2, 'two outlets';
  perform set_config('test.shared', v_recipe::text, true);
  perform set_config('test.shared_version', v_version::text, true);

  begin
    perform public.create_recipe(null, true, false, 'All');
    raise exception 'manager cannot make an all-outlet recipe';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.create_recipe(
      (select array_agg(id) from public.outlets where code in ('JB-BROOOS', 'KL-CABINET8')), false, false, 'X');
    raise exception 'manager cannot pick an outlet they do not manage';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.create_recipe('{}', false, false, 'X');
    raise exception 'an outlet is required';
  exception when check_violation then
    null;
  end;
end;
$$;

-- M1 (one of the two outlets) reads it but cannot edit or submit -----------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
begin
  assert exists (select 1 from public.recipes where id = current_setting('test.shared')::uuid), 'M1 sees it';
  assert not private.can_edit_recipe_version(current_setting('test.shared_version')::uuid), 'M1 cannot edit';
  update public.recipe_versions set product_name = 'Hacked' where id = current_setting('test.shared_version')::uuid;
  assert not found, 'M1 update ignored';
  begin
    perform public.submit_recipe_version(current_setting('test.shared_version')::uuid, 1);
    raise exception 'M1 cannot submit';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

-- MK (KL) does not see it at all ---------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
do $$
begin
  assert not exists (select 1 from public.recipes where id = current_setting('test.shared')::uuid), 'MK hidden';
  assert not exists (select 1 from public.recipe_versions
                      where recipe_id = current_setting('test.shared')::uuid), 'MK versions hidden';
end;
$$;

-- Admin makes an all-outlet Prep and a drink for KL-CABINET8 ------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
declare
  v uuid;
begin
  v := public.create_recipe(null, true, true, 'House Syrup');
  perform set_config('test.syrup', (select recipe_id from public.recipe_versions where id = v)::text, true);
  assert (select all_outlets from public.recipes where id = current_setting('test.syrup')::uuid), 'all outlets';
  v := public.create_recipe(
    (select array_agg(id) from public.outlets where code = 'KL-CABINET8'), false, true, 'KL Syrup');
  perform set_config('test.kl_syrup', (select recipe_id from public.recipe_versions where id = v)::text, true);
end;
$$;

-- Everyone sees the all-outlet recipe; only the Admin edits it.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
do $$
begin
  assert exists (select 1 from public.recipes where id = current_setting('test.syrup')::uuid), 'MK sees all-outlet';
  assert not private.can_manage_recipe(current_setting('test.syrup')::uuid), 'MK cannot edit all-outlet';
end;
$$;

-- Prep must cover the drink's outlets ----------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  insert into public.recipe_ingredients (recipe_version_id, sort_order, prep_recipe_id, quantity, unit)
  values (current_setting('test.shared_version')::uuid, 1, current_setting('test.syrup')::uuid, 10, 'ml');
end;
$$;
reset role;
do $$
begin
  insert into public.recipe_ingredients (recipe_version_id, sort_order, prep_recipe_id, quantity, unit)
  values (current_setting('test.shared_version')::uuid, 2, current_setting('test.kl_syrup')::uuid, 10, 'ml');
  raise exception 'KL Prep should not fit a JB recipe';
exception when check_violation then
  null;
end;
$$;

-- Menus use only recipes made for their outlet --------------------------------------------
update public.recipe_versions set status = 'APPROVED' where id = current_setting('test.shared_version')::uuid;
update public.recipes set current_approved_version_id = current_setting('test.shared_version')::uuid
 where id = current_setting('test.shared')::uuid;
insert into public.menus (id, outlet_id, name, status, created_by)
  select '60000000-0000-0000-0000-000000000001', id, 'YouBar', 'PUBLISHED', '00000000-0000-0000-0000-00000000000b'
    from public.outlets where code = 'JB-YOUBAR';
insert into public.menus (id, outlet_id, name, status, created_by)
  select '60000000-0000-0000-0000-000000000002', id, 'KL', 'DRAFT', '00000000-0000-0000-0000-00000000000d'
    from public.outlets where code = 'KL-CABINET8';
insert into public.menu_items (menu_id, recipe_id, price, sort_order)
  values ('60000000-0000-0000-0000-000000000001', current_setting('test.shared')::uuid, 12, 1);
do $$
begin
  insert into public.menu_items (menu_id, recipe_id, price, sort_order)
    values ('60000000-0000-0000-0000-000000000002', current_setting('test.shared')::uuid, 12, 1);
  raise exception 'KL menu should not use a JB recipe';
exception when check_violation then
  null;
end;
$$;

-- The JB-YOUBAR Barista sees it through the published menu.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
do $$
begin
  assert exists (select 1 from public.recipes where id = current_setting('test.shared')::uuid), 'barista sees SOP';
  assert not exists (select 1 from public.recipes where id = current_setting('test.kl_syrup')::uuid),
    'barista does not see other outlet';
end;
$$;

-- Copy needs a visible source --------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
do $$
begin
  perform public.copy_recipe(current_setting('test.shared')::uuid,
    (select id from public.outlets where code = 'KL-CABINET8'), 'Copy', '{}', null);
  raise exception 'MK cannot copy a hidden recipe';
exception when insufficient_privilege then
  null;
end;
$$;

rollback;
