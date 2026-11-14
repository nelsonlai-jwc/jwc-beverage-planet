-- Undoing an approval pressed by mistake: materials, prices and recipe versions.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local', 'TEST ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local', 'TEST MANAGER', 'MANAGER');
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000b', id from public.outlets where code = 'JB-BROOOS';

-- Materials ------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
insert into public.materials (id, name, brand, material_type_id)
  select '10000000-0000-0000-0000-000000000001', 'Fresh Milk', 'Test Dairy', id
    from public.material_types where name = 'Other';
insert into public.material_packs (id, material_id, pack_quantity, unit) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1000, 'ml');
insert into public.material_price_versions (id, pack_id, price) values
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 6.35);
select public.submit_material('10000000-0000-0000-0000-000000000001');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select public.approve_material('10000000-0000-0000-0000-000000000001');

-- A Manager cannot undo; a reason is required.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  perform public.undo_approval('MATERIAL', '10000000-0000-0000-0000-000000000001', 'oops');
  raise exception 'manager should not undo';
exception when insufficient_privilege then
  null;
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
begin
  perform public.undo_approval('MATERIAL', '10000000-0000-0000-0000-000000000001', ' ');
  raise exception 'reason required';
exception when invalid_parameter_value then
  assert sqlerrm = 'REASON_REQUIRED', sqlerrm;
end;
$$;

-- Admin undoes the new material: material, pack and price are pending again.
select public.undo_approval('MATERIAL', '10000000-0000-0000-0000-000000000001', 'Approved by mistake');
do $$
begin
  assert (select status from public.materials where id = '10000000-0000-0000-0000-000000000001') = 'PENDING';
  assert (select approved_at from public.materials where id = '10000000-0000-0000-0000-000000000001') is null;
  assert (select status from public.material_packs where id = '20000000-0000-0000-0000-000000000001') = 'PENDING';
  assert (select status from public.material_price_versions
           where id = '21000000-0000-0000-0000-000000000001') = 'PENDING';
  assert exists (select 1 from public.approval_events
                  where entity_type = 'MATERIAL' and action = 'ROLLBACK' and reason = 'Approved by mistake');
  perform public.undo_approval('MATERIAL', '10000000-0000-0000-0000-000000000001', 'again');
  raise exception 'pending material cannot be undone';
exception when invalid_parameter_value then
  assert sqlerrm = 'NOT_CURRENT_APPROVAL', sqlerrm;
end;
$$;

-- Approve again, then a price change 6.35 -> 7.00 approved by mistake.
select public.approve_material('10000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
insert into public.material_price_versions (id, pack_id, price) values
  ('21000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 7.00);
select public.submit_material_price('21000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);

do $$
begin
  perform public.undo_approval('MATERIAL_PRICE', '21000000-0000-0000-0000-000000000001', 'x');
  raise exception 'price with a pending proposal cannot be undone';
exception when invalid_parameter_value then
  assert sqlerrm = 'OPEN_PRICE_EXISTS', sqlerrm;
end;
$$;

select public.approve_material_price('21000000-0000-0000-0000-000000000002');
do $$
begin
  -- Undoing the first price has nothing to return to; undo the material instead.
  perform public.undo_approval('MATERIAL', '10000000-0000-0000-0000-000000000001', 'x');
  raise exception 'material with a later price change cannot be undone';
exception when invalid_parameter_value then
  assert sqlerrm = 'LATER_CHANGES', sqlerrm;
end;
$$;

select public.undo_approval('MATERIAL_PRICE', '21000000-0000-0000-0000-000000000002', 'Wrong price');
do $$
begin
  assert (select status from public.material_price_versions
           where id = '21000000-0000-0000-0000-000000000002') = 'PENDING';
  assert (select effective_from from public.material_price_versions
           where id = '21000000-0000-0000-0000-000000000002') is null;
  assert (select status from public.material_price_versions
           where id = '21000000-0000-0000-0000-000000000001') = 'APPROVED';
  assert public.material_unit_cost('10000000-0000-0000-0000-000000000001') is not null;
end;
$$;
-- The undone price can be returned as usual.
select public.return_material_price('21000000-0000-0000-0000-000000000002', 'Supplier quote was wrong');

-- Packaging price ---------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
insert into public.packaging_items (id, name) values ('30000000-0000-0000-0000-000000000001', 'Cup Lid');
insert into public.packaging_prices (id, packaging_item_id, price_per_piece) values
  ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 0.10);
select public.submit_packaging_item('30000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select public.approve_packaging_item('30000000-0000-0000-0000-000000000001');
do $$
begin
  perform public.undo_approval('PACKAGING_PRICE', '31000000-0000-0000-0000-000000000001', 'x');
  raise exception 'first price has nothing to return to';
exception when invalid_parameter_value then
  assert sqlerrm = 'NO_PREVIOUS_PRICE', sqlerrm;
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
insert into public.packaging_prices (id, packaging_item_id, price_per_piece) values
  ('31000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 0.20);
select public.submit_packaging_price('31000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select public.approve_packaging_price('31000000-0000-0000-0000-000000000002');
select public.undo_approval('PACKAGING_PRICE', '31000000-0000-0000-0000-000000000002', 'Wrong price');
do $$
begin
  assert (select status from public.packaging_prices where id = '31000000-0000-0000-0000-000000000002') = 'PENDING';
  assert (select status from public.packaging_prices where id = '31000000-0000-0000-0000-000000000001') = 'APPROVED';
end;
$$;

-- Recipes -----------------------------------------------------------------------------
-- R1: V1 superseded by V2 (current). R2: only V1, on a published menu.
reset role;
insert into public.recipes (id, outlet_id, is_prep, created_by)
  select r.id, o.id, false, '00000000-0000-0000-0000-00000000000b'
    from public.outlets o,
         (values ('40000000-0000-0000-0000-000000000001'::uuid), ('40000000-0000-0000-0000-000000000002')) as r (id)
   where o.code = 'JB-BROOOS';
insert into public.recipe_versions (id, recipe_id, version_no, status, product_name, style, temperature,
                                    created_by, approved_at)
values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 'SUPERSEDED',
   'Iced Latte', 'COFFEE', 'COLD', '00000000-0000-0000-0000-00000000000b', now() - interval '2 days'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 2, 'APPROVED',
   'Iced Latte', 'COFFEE', 'COLD', '00000000-0000-0000-0000-00000000000b', now()),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002', 1, 'APPROVED',
   'Hot Latte', 'COFFEE', 'HOT', '00000000-0000-0000-0000-00000000000b', now());
update public.recipes set current_approved_version_id = '50000000-0000-0000-0000-000000000002'
 where id = '40000000-0000-0000-0000-000000000001';
update public.recipes set current_approved_version_id = '50000000-0000-0000-0000-000000000003'
 where id = '40000000-0000-0000-0000-000000000002';
insert into public.menus (id, outlet_id, name, status, created_by)
  select '60000000-0000-0000-0000-000000000001', id, 'Main', 'PUBLISHED', '00000000-0000-0000-0000-00000000000b'
    from public.outlets where code = 'JB-BROOOS';
insert into public.menu_items (menu_id, recipe_id, price, sort_order) values
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 12, 1),
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', 12, 2);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
begin
  perform public.undo_approval('RECIPE_VERSION', '50000000-0000-0000-0000-000000000001', 'x');
  raise exception 'old version cannot be undone';
exception when invalid_parameter_value then
  assert sqlerrm = 'NOT_CURRENT_APPROVAL', sqlerrm;
end;
$$;
do $$
begin
  perform public.undo_approval('RECIPE_VERSION', '50000000-0000-0000-0000-000000000003', 'x');
  raise exception 'first approval on a published menu cannot be undone';
exception when invalid_parameter_value then
  assert sqlerrm = 'ON_MENU', sqlerrm;
end;
$$;

select public.undo_approval('RECIPE_VERSION', '50000000-0000-0000-0000-000000000002', 'Approved by mistake');
do $$
begin
  assert (select status from public.recipe_versions where id = '50000000-0000-0000-0000-000000000002') = 'PENDING';
  assert (select status from public.recipe_versions where id = '50000000-0000-0000-0000-000000000001') = 'APPROVED';
  assert (select current_approved_version_id from public.recipes
           where id = '40000000-0000-0000-0000-000000000001') = '50000000-0000-0000-0000-000000000001';
  assert exists (select 1 from public.approval_events
                  where entity_id = '50000000-0000-0000-0000-000000000002' and action = 'ROLLBACK');
  assert exists (select 1 from public.menu_publish_history
                  where snapshot ->> 'from_version_id' = '50000000-0000-0000-0000-000000000002');
  -- V2 is now the open version, so V1 cannot be undone too.
  perform public.undo_approval('RECIPE_VERSION', '50000000-0000-0000-0000-000000000001', 'x');
  raise exception 'recipe with an open version cannot be undone';
exception when invalid_parameter_value then
  assert sqlerrm = 'OPEN_VERSION_EXISTS', sqlerrm;
end;
$$;

-- The undone version is reviewed again as usual.
select public.return_recipe_version('50000000-0000-0000-0000-000000000002', 'Needs more milk');

rollback;
