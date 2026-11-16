-- Menu categories: one nested tree per outlet, managed by its Managers and Admins.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

-- Users: Admin; Manager M of JB-BROOOS; Manager MK of KL-CABINET8; Barista of JB-BROOOS.
alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'm@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'mk@test.local'),
  ('00000000-0000-0000-0000-00000000000e', 'barista@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local', 'TEST ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-00000000000b', 'm@test.local', 'MANAGER', 'MANAGER'),
  ('00000000-0000-0000-0000-00000000000d', 'mk@test.local', 'MANAGER KL', 'MANAGER');
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000b', id from public.outlets where code = 'JB-BROOOS';
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000d', id from public.outlets where code = 'KL-CABINET8';
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000e', 'barista@test.local', 'BARISTA', 'BARISTA');
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000e', id from public.outlets where code = 'JB-BROOOS';

-- The Manager builds a three-level tree ---------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
insert into public.menu_categories (id, outlet_id, parent_id, name, sort_order)
  select '70000000-0000-0000-0000-000000000001', id, null, 'Coffee', 1 from public.outlets where code = 'JB-BROOOS';
insert into public.menu_categories (id, outlet_id, parent_id, name, sort_order)
  select '70000000-0000-0000-0000-000000000002', id, '70000000-0000-0000-0000-000000000001', 'Milk-based', 1
    from public.outlets where code = 'JB-BROOOS';
insert into public.menu_categories (id, outlet_id, parent_id, name, sort_order)
  select '70000000-0000-0000-0000-000000000003', id, '70000000-0000-0000-0000-000000000002', 'Iced', 1
    from public.outlets where code = 'JB-BROOOS';
insert into public.menu_categories (id, outlet_id, parent_id, name, sort_order)
  select '70000000-0000-0000-0000-000000000004', id, '70000000-0000-0000-0000-000000000003', 'Large', 1
    from public.outlets where code = 'JB-BROOOS';

do $$
begin
  -- Not in an outlet the Manager does not manage.
  begin
    insert into public.menu_categories (outlet_id, name)
      select id, 'Tea' from public.outlets where code = 'KL-CABINET8';
    raise exception 'manager should not add to another outlet';
  exception when insufficient_privilege then
    null;
  end;
  -- Same name under the same parent is refused (case and spaces ignored).
  begin
    insert into public.menu_categories (outlet_id, name)
      select id, ' coffee ' from public.outlets where code = 'JB-BROOOS';
    raise exception 'duplicate main category should fail';
  exception when unique_violation then
    null;
  end;
  -- The same name under another parent is fine.
  insert into public.menu_categories (outlet_id, parent_id, name)
    select id, '70000000-0000-0000-0000-000000000001', 'Iced' from public.outlets where code = 'JB-BROOOS';
  -- Rename works; moving to another parent does not.
  update public.menu_categories set name = 'Milk Coffee' where id = '70000000-0000-0000-0000-000000000002';
  assert (select name from public.menu_categories where id = '70000000-0000-0000-0000-000000000002')
    = 'Milk Coffee', 'renamed';
  begin
    update public.menu_categories set parent_id = null where id = '70000000-0000-0000-0000-000000000003';
    raise exception 'moving should fail';
  exception when check_violation then
    null;
  end;
  -- A category with sub-categories cannot be deleted.
  begin
    delete from public.menu_categories where id = '70000000-0000-0000-0000-000000000003';
    raise exception 'delete with children should fail';
  exception when foreign_key_violation then
    assert sqlerrm = 'CATEGORY_HAS_CHILDREN', sqlerrm;
  end;
  -- A leaf with no drinks can.
  delete from public.menu_categories where id = '70000000-0000-0000-0000-000000000004';
end;
$$;

-- Other outlets cannot see or change it; the outlet's Barista can read it.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', true);
do $$
begin
  assert not exists (select 1 from public.menu_categories), 'KL manager sees no JB categories';
  update public.menu_categories set name = 'X' where id = '70000000-0000-0000-0000-000000000001';
  delete from public.menu_categories where id = '70000000-0000-0000-0000-000000000003';
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
do $$
begin
  assert (select count(*) from public.menu_categories) = 4, 'barista reads own outlet categories';
  update public.menu_categories set name = 'X' where id = '70000000-0000-0000-0000-000000000001';
end;
$$;
reset role;
do $$
begin
  assert (select name from public.menu_categories where id = '70000000-0000-0000-0000-000000000001') = 'Coffee',
    'others could not rename';
  assert exists (select 1 from public.menu_categories where id = '70000000-0000-0000-0000-000000000003'),
    'others could not delete';
  -- A sub-category must be in its parent's outlet.
  begin
    insert into public.menu_categories (outlet_id, parent_id, name, created_by)
      select id, '70000000-0000-0000-0000-000000000001', 'Wrong', '00000000-0000-0000-0000-00000000000a'
        from public.outlets where code = 'KL-CABINET8';
    raise exception 'cross-outlet parent should fail';
  exception when check_violation then
    null;
  end;
end;
$$;

-- Drinks in categories, publish, delete rules ---------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
select set_config('test.version',
  public.create_recipe((select array_agg(id) from public.outlets where code = 'JB-BROOOS'), false, false, 'Iced Latte')::text,
  true);
reset role;
update public.recipe_versions set status = 'APPROVED', purpose = 'OFFICIAL_RELEASE'
 where id = current_setting('test.version')::uuid;
update public.recipes r set current_approved_version_id = v.id
  from public.recipe_versions v where v.id = current_setting('test.version')::uuid and r.id = v.recipe_id;
select set_config('test.recipe',
  (select recipe_id::text from public.recipe_versions where id = current_setting('test.version')::uuid), true);
insert into public.menu_categories (id, outlet_id, name, created_by)
  select '70000000-0000-0000-0000-000000000009', id, 'KL Tea', '00000000-0000-0000-0000-00000000000d'
    from public.outlets where code = 'KL-CABINET8';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
insert into public.menus (id, outlet_id, name)
  select '60000000-0000-0000-0000-000000000001', id, 'Main' from public.outlets where code = 'JB-BROOOS';
insert into public.menu_revisions (id, menu_id)
  values ('61000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001');
do $$
begin
  -- A category of another outlet is refused.
  begin
    insert into public.menu_revision_items (menu_revision_id, recipe_id, price, sort_order, category_id)
      values ('61000000-0000-0000-0000-000000000001', current_setting('test.recipe')::uuid, 12, 1,
              '70000000-0000-0000-0000-000000000009');
    raise exception 'other outlet category should fail';
  exception when check_violation then
    null;
  end;
end;
$$;
-- Any level works; here the third level.
insert into public.menu_revision_items (menu_revision_id, recipe_id, price, sort_order, category_id)
  values ('61000000-0000-0000-0000-000000000001', current_setting('test.recipe')::uuid, 12, 1,
          '70000000-0000-0000-0000-000000000003');
do $$
begin
  -- Used by a pending drink: cannot delete.
  begin
    delete from public.menu_categories where id = '70000000-0000-0000-0000-000000000003';
    raise exception 'delete in use should fail';
  exception when foreign_key_violation then
    assert sqlerrm = 'CATEGORY_IN_USE', sqlerrm;
  end;
end;
$$;
select public.publish_menu('60000000-0000-0000-0000-000000000001');
do $$
begin
  assert (select category_id from public.menu_items where menu_id = '60000000-0000-0000-0000-000000000001')
    = '70000000-0000-0000-0000-000000000003', 'publish keeps the category';
  assert (select snapshot -> 0 ->> 'category_name' from public.menu_publish_history
           where menu_id = '60000000-0000-0000-0000-000000000001') = 'Iced', 'history has the category';
  -- Used by a live drink: cannot delete.
  begin
    delete from public.menu_categories where id = '70000000-0000-0000-0000-000000000003';
    raise exception 'delete in use should fail';
  exception when foreign_key_violation then
    assert sqlerrm = 'CATEGORY_IN_USE', sqlerrm;
  end;
end;
$$;
-- An archived menu does not block deleting; its drink becomes uncategorized.
select public.archive_menu('60000000-0000-0000-0000-000000000001');
delete from public.menu_categories where id = '70000000-0000-0000-0000-000000000003';
reset role;
do $$
begin
  assert not exists (select 1 from public.menu_categories where id = '70000000-0000-0000-0000-000000000003'),
    'deleted';
  assert (select category_id from public.menu_items where menu_id = '60000000-0000-0000-0000-000000000001') is null,
    'archived drink uncategorized';
end;
$$;

rollback;
