-- Archiving, restoring and publishing recipes, and the recipe change log.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

-- Users: one Admin, a Manager of JB-BROOOS and a Manager of another outlet.
alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'other@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local', 'TEST ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local', 'TEST MANAGER', 'MANAGER'),
  ('00000000-0000-0000-0000-00000000000c', 'other@test.local', 'OTHER MANAGER', 'MANAGER');
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000b', id from public.outlets where code = 'JB-BROOOS';
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000c', id from public.outlets where code = 'JB-YOUBAR';

-- Recipes of JB-BROOOS, set up directly:
--   P  approved Prep syrup, used by D
--   D  approved drink using P
--   E  approved drink on a published menu
--   G  drink that was returned and never approved
insert into public.recipes (id, outlet_id, is_prep, created_by)
  select r.id, o.id, r.is_prep, '00000000-0000-0000-0000-00000000000b'
    from public.outlets o,
         (values ('40000000-0000-0000-0000-000000000001'::uuid, true),
                 ('40000000-0000-0000-0000-000000000002', false),
                 ('40000000-0000-0000-0000-000000000003', false),
                 ('40000000-0000-0000-0000-000000000004', false)) as r (id, is_prep)
   where o.code = 'JB-BROOOS';
insert into public.recipe_versions (id, recipe_id, version_no, status, product_name, style, yield_quantity, yield_unit, created_by)
values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 'APPROVED',
   'Sugar Syrup', 'PREP_MATERIAL', 800, 'ml', '00000000-0000-0000-0000-00000000000b');
insert into public.recipe_versions (id, recipe_id, version_no, status, product_name, style, temperature, created_by)
values
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 1, 'APPROVED',
   'Iced Latte', 'COFFEE', 'COLD', '00000000-0000-0000-0000-00000000000b'),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', 1, 'APPROVED',
   'Hot Latte', 'COFFEE', 'HOT', '00000000-0000-0000-0000-00000000000b'),
  ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', 1, 'RETURNED',
   'Mocha', 'COFFEE', 'HOT', '00000000-0000-0000-0000-00000000000b');
update public.recipes r set current_approved_version_id = v.id
  from public.recipe_versions v
 where v.recipe_id = r.id and v.status = 'APPROVED';
insert into public.recipe_ingredients (recipe_version_id, sort_order, prep_recipe_id, quantity, unit) values
  ('50000000-0000-0000-0000-000000000002', 1, '40000000-0000-0000-0000-000000000001', 20, 'ml');
insert into public.menus (id, outlet_id, name, status, created_by)
  select '60000000-0000-0000-0000-000000000001', id, 'Main', 'PUBLISHED', '00000000-0000-0000-0000-00000000000b'
    from public.outlets where code = 'JB-BROOOS';
insert into public.menu_items (menu_id, recipe_id, price, sort_order) values
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003', 12, 1);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);

-- Blocked archives: Prep in use, drink on a published menu, no reason ------------------
do $$
begin
  begin
    perform public.request_change('RECIPE', '40000000-0000-0000-0000-000000000001', 'ARCHIVE', null, 'old');
    raise exception 'prep in use should not archive';
  exception when invalid_parameter_value then
    assert sqlerrm = 'IN_USE', sqlerrm;
  end;
  begin
    perform public.request_change('RECIPE', '40000000-0000-0000-0000-000000000003', 'ARCHIVE', null, 'old');
    raise exception 'drink on menu should not archive';
  exception when invalid_parameter_value then
    assert sqlerrm = 'ON_MENU', sqlerrm;
  end;
  begin
    perform public.request_change('RECIPE', '40000000-0000-0000-0000-000000000003', 'ARCHIVE', null, ' ');
    raise exception 'manager archive needs a reason';
  exception when invalid_parameter_value then
    assert sqlerrm = 'REASON_REQUIRED', sqlerrm;
  end;
  begin
    perform public.request_change('RECIPE', '40000000-0000-0000-0000-000000000003', 'EDIT', '{}', 'x');
    raise exception 'recipe edits go through versions';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

-- Manager of another outlet cannot touch E.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
begin
  perform public.request_change('RECIPE', '40000000-0000-0000-0000-000000000003', 'ARCHIVE', null, 'no');
  raise exception 'other outlet should not archive';
exception when insufficient_privilege then
  null;
end;
$$;

-- E comes off the menu; B asks to archive it, Admin approves --------------------------
reset role;
update public.menus set status = 'DRAFT' where id = '60000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);

do $$
begin
  assert public.request_change('RECIPE', '40000000-0000-0000-0000-000000000003', 'ARCHIVE', null, 'Seasonal')
    = 'REQUESTED', 'manager archive is a request';
  assert (select status from public.recipes where id = '40000000-0000-0000-0000-000000000003') = 'ACTIVE',
    'still active while pending';
  assert (select outlet_id from public.change_requests where entity_id = '40000000-0000-0000-0000-000000000003')
    = (select id from public.outlets where code = 'JB-BROOOS'), 'request carries the outlet';
  begin
    perform public.request_change('RECIPE', '40000000-0000-0000-0000-000000000003', 'ARCHIVE', null, 'again');
    raise exception 'second request should fail';
  exception when invalid_parameter_value then
    assert sqlerrm = 'REQUEST_ALREADY_PENDING', sqlerrm;
  end;
end;
$$;

-- The other outlet's Manager does not see the request.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
begin
  assert not exists (select 1 from public.change_requests where entity_type = 'RECIPE'), 'request hidden';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select public.review_change_request(
  (select id from public.change_requests where entity_id = '40000000-0000-0000-0000-000000000003'), true);

-- Nothing new happens on an archived recipe.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  assert (select status from public.recipes where id = '40000000-0000-0000-0000-000000000003') = 'ARCHIVED',
    'archived after approval';
  begin
    perform public.create_recipe_version('40000000-0000-0000-0000-000000000003');
    raise exception 'archived recipe should not get a new version';
  exception when invalid_parameter_value then
    assert sqlerrm = 'RECIPE_ARCHIVED', sqlerrm;
  end;
  begin
    perform public.restore_archived('RECIPE', '40000000-0000-0000-0000-000000000003');
    raise exception 'manager should not restore';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

-- G was never approved: its Manager archives it directly, and its open version is frozen.
do $$
begin
  assert public.request_change('RECIPE', '40000000-0000-0000-0000-000000000004', 'ARCHIVE', null, null)
    = 'APPLIED', 'unapproved recipe archives directly';
  begin
    perform public.save_recipe_draft('50000000-0000-0000-0000-000000000004',
      (select revision from public.recipe_versions where id = '50000000-0000-0000-0000-000000000004'),
      '{"product_name": "Mocha 2"}');
    raise exception 'archived draft should not save';
  exception when invalid_parameter_value then
    assert sqlerrm = 'RECIPE_ARCHIVED', sqlerrm;
  end;
end;
$$;

-- Admin restores E and archives D directly ------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select public.restore_archived('RECIPE', '40000000-0000-0000-0000-000000000003');
do $$
begin
  assert (select status from public.recipes where id = '40000000-0000-0000-0000-000000000003') = 'ACTIVE',
    'restored';
  assert public.request_change('RECIPE', '40000000-0000-0000-0000-000000000002', 'ARCHIVE', null, null)
    = 'APPLIED', 'admin archives directly';
  -- With D archived, nothing live uses the syrup any more.
  assert public.request_change('RECIPE', '40000000-0000-0000-0000-000000000001', 'ARCHIVE', null, null)
    = 'APPLIED', 'unused prep archives';
end;
$$;

-- Admin edit of an approved recipe: an incomplete version is not published -----------
select public.create_recipe_version('40000000-0000-0000-0000-000000000003');
do $$
declare
  v_id uuid;
  v_result jsonb;
begin
  select id into v_id from public.recipe_versions
   where recipe_id = '40000000-0000-0000-0000-000000000003' and status = 'DRAFT';
  v_result := public.publish_recipe_version(v_id, (select revision from public.recipe_versions where id = v_id), 'k1');
  assert jsonb_array_length(v_result -> 'errors') > 0, 'missing fields reported: ' || v_result::text;
  assert (select status from public.recipe_versions where id = v_id) = 'DRAFT', 'still a draft';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  perform public.publish_recipe_version(
    (select id from public.recipe_versions
      where recipe_id = '40000000-0000-0000-0000-000000000003' and status = 'DRAFT'), 1, 'k2');
  raise exception 'manager should not publish';
exception when insufficient_privilege then
  null;
end;
$$;

-- Change log --------------------------------------------------------------------------
do $$
begin
  assert exists (select 1 from public.recipe_change_log('40000000-0000-0000-0000-000000000003')
                  where source = 'REQUEST' and action = 'ARCHIVE:APPROVED' and reason = 'Seasonal'
                    and actor_name = 'TEST MANAGER'), 'request logged';
  assert exists (select 1 from public.recipe_change_log('40000000-0000-0000-0000-000000000003')
                  where source = 'REVIEW' and actor_name = 'TEST ADMIN'), 'review logged';
  assert exists (select 1 from public.recipe_change_log('40000000-0000-0000-0000-000000000003')
                  where source = 'REQUEST' and action = 'RESTORE:DIRECT'), 'restore logged';
  assert exists (select 1 from public.recipe_change_log('40000000-0000-0000-0000-000000000003')
                  where source = 'VERSION' and action = 'NEW_VERSION' and version_no = 2), 'new version logged';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
begin
  perform public.recipe_change_log('40000000-0000-0000-0000-000000000003');
  raise exception 'other outlet should not read the log';
exception when insufficient_privilege then
  null;
end;
$$;

rollback;
