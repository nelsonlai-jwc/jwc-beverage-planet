-- Material approval and cost calculation, using the sample in design plan ch. 14.2.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

-- Users: one Admin, one Manager of JB-BROOOS.
alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local', 'TEST ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local', 'TEST MANAGER', 'MANAGER');
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000b', id from public.outlets where code = 'JB-BROOOS';

-- Manager registers milk, matcha, sugar and a lid ---------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);

insert into public.materials (id, name, brand, material_type_id)
  select '10000000-0000-0000-0000-000000000001', 'Fresh Milk', 'Test Dairy', id
    from public.material_types where name = 'Other';
insert into public.materials (id, name, brand, material_type_id)
  select '10000000-0000-0000-0000-000000000002', 'Matcha', 'Test Tea', id
    from public.material_types where name = 'Other';
insert into public.materials (id, name, no_brand, material_type_id)
  select '10000000-0000-0000-0000-000000000003', 'Sugar', true, id
    from public.material_types where name = 'Other';
insert into public.materials (id, name, no_brand, material_type_id)
  select '10000000-0000-0000-0000-000000000004', 'Unpriced Syrup', true, id
    from public.material_types where name = 'Syrup';

insert into public.material_packs (id, material_id, pack_quantity, unit) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1000, 'ml'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 30, 'g'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 1000, 'g'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 500, 'ml');
insert into public.material_price_versions (pack_id, price) values
  ('20000000-0000-0000-0000-000000000001', 6.35),
  ('20000000-0000-0000-0000-000000000002', 75),
  ('20000000-0000-0000-0000-000000000003', 12);

insert into public.packaging_items (id, name) values ('30000000-0000-0000-0000-000000000001', 'Cup Lid');
insert into public.packaging_prices (packaging_item_id, price_per_piece)
  values ('30000000-0000-0000-0000-000000000001', 0.40);

select public.submit_material('10000000-0000-0000-0000-000000000001');
select public.submit_material('10000000-0000-0000-0000-000000000002');
select public.submit_material('10000000-0000-0000-0000-000000000003');
select public.submit_material('10000000-0000-0000-0000-000000000004');
select public.submit_packaging_item('30000000-0000-0000-0000-000000000001');

-- A Manager cannot approve.
do $$
begin
  perform public.approve_material('10000000-0000-0000-0000-000000000001');
  raise exception 'Manager approval should fail';
exception when insufficient_privilege then
  null;
end;
$$;

-- Admin approves; returning needs a reason --------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);

do $$
begin
  perform public.return_material('10000000-0000-0000-0000-000000000004', '  ');
  raise exception 'Return without reason should fail';
exception when invalid_parameter_value then
  null;
end;
$$;

select public.approve_material('10000000-0000-0000-0000-000000000001');
select public.approve_material('10000000-0000-0000-0000-000000000002');
select public.approve_material('10000000-0000-0000-0000-000000000003');
select public.approve_material('10000000-0000-0000-0000-000000000004');
select public.approve_packaging_item('30000000-0000-0000-0000-000000000001');

do $$
declare
  v jsonb;
begin
  v := public.material_unit_cost('10000000-0000-0000-0000-000000000001');
  assert (v ->> 'unit_cost')::numeric = 0.00635, 'milk unit cost ' || (v ->> 'unit_cost');
  assert v ->> 'reason' is null, 'milk reason';
  v := public.material_unit_cost('10000000-0000-0000-0000-000000000004');
  assert v ->> 'reason' = 'PRICE_MISSING', 'unpriced reason ' || coalesce(v ->> 'reason', 'null');
  assert v -> 'unit_cost' = 'null'::jsonb, 'unpriced must not be zero';
end;
$$;

-- Recipes: Prep syrup (sugar RM12, yield 800 ml) and a drink ---------------
reset role;

insert into public.recipes (id, outlet_id, is_prep)
  select '40000000-0000-0000-0000-000000000001', id, true from public.outlets where code = 'JB-BROOOS';
insert into public.recipes (id, outlet_id, is_prep)
  select '40000000-0000-0000-0000-000000000002', id, false from public.outlets where code = 'JB-BROOOS';
insert into public.recipe_versions
  (id, recipe_id, version_no, status, product_name, style, yield_quantity, yield_unit, created_by)
values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 'APPROVED',
   'Sugar Syrup', 'PREP_MATERIAL', 800, 'ml', '00000000-0000-0000-0000-00000000000b');
insert into public.recipe_versions (id, recipe_id, version_no, status, product_name, created_by)
values
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 1, 'DRAFT',
   'Matcha Latte', '00000000-0000-0000-0000-00000000000b');
update public.recipes set current_approved_version_id = '50000000-0000-0000-0000-000000000001'
 where id = '40000000-0000-0000-0000-000000000001';

insert into public.recipe_ingredients (recipe_version_id, sort_order, material_id, quantity, unit) values
  ('50000000-0000-0000-0000-000000000001', 1, '10000000-0000-0000-0000-000000000003', 1000, 'g'),
  ('50000000-0000-0000-0000-000000000002', 1, '10000000-0000-0000-0000-000000000001', 180, 'ml'),
  ('50000000-0000-0000-0000-000000000002', 2, '10000000-0000-0000-0000-000000000002', 4, 'g');
insert into public.recipe_ingredients (recipe_version_id, sort_order, prep_recipe_id, quantity, unit) values
  ('50000000-0000-0000-0000-000000000002', 3, '40000000-0000-0000-0000-000000000001', 20, 'ml');
insert into public.recipe_packaging (recipe_version_id, packaging_item_id, pieces, sort_order) values
  ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 1, 1);

-- Sample ch. 14.2: 1.143 + 10.000 + 0.300 + 0.400 = 11.843, shown as RM11.84.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);

do $$
declare
  v jsonb;
  v_prep jsonb;
begin
  v := public.calculate_recipe_cost('50000000-0000-0000-0000-000000000002');
  assert (v ->> 'is_complete')::boolean, 'sample complete: ' || (v -> 'incomplete_reasons')::text;
  assert (v ->> 'total_cost')::numeric = 11.843, 'sample total ' || (v ->> 'total_cost');
  assert round((v ->> 'total_cost')::numeric, 2) = 11.84, 'sample display total';
  assert round(20 - (v ->> 'total_cost')::numeric, 2) = 8.16, 'sample direct margin';
  assert ((v -> 'lines' -> 0 ->> 'line_cost')::numeric) = 1.143, 'milk line';
  assert ((v -> 'lines' -> 1 ->> 'line_cost')::numeric) = 10, 'matcha line';
  v_prep := v -> 'lines' -> 2;
  assert v_prep ->> 'line_type' = 'PREP', 'prep line type';
  assert (v_prep ->> 'unit_cost')::numeric = 0.015, 'prep unit cost ' || (v_prep ->> 'unit_cost');
  assert (v_prep ->> 'line_cost')::numeric = 0.3, 'prep line';
  assert jsonb_array_length(v_prep -> 'children') = 1, 'prep children';
  assert ((v -> 'lines' -> 3 ->> 'line_cost')::numeric) = 0.4, 'lid line';
end;
$$;

-- Cost ratio of the sample: 11.843 / 20 = 59.215% -> 59.22%.
do $$
begin
  assert round(11.843::numeric / 20 * 100, 2) = 59.22, 'cost ratio';
end;
$$;

-- Incomplete cost: unit mismatch and missing price are reported, never zero.
reset role;
insert into public.recipe_ingredients (recipe_version_id, sort_order, material_id, quantity, unit) values
  ('50000000-0000-0000-0000-000000000002', 4, '10000000-0000-0000-0000-000000000002', 1, 'ml'),
  ('50000000-0000-0000-0000-000000000002', 5, '10000000-0000-0000-0000-000000000004', 10, 'ml');
set local role authenticated;

do $$
declare
  v jsonb;
  v_codes text[];
begin
  v := public.calculate_recipe_cost('50000000-0000-0000-0000-000000000002');
  assert not (v ->> 'is_complete')::boolean, 'should be incomplete';
  assert v -> 'total_cost' = 'null'::jsonb, 'incomplete total must be null';
  select array_agg(r ->> 'code' order by r ->> 'code') into v_codes
    from jsonb_array_elements(v -> 'incomplete_reasons') r;
  assert v_codes = array['PRICE_MISSING', 'UNIT_MISMATCH'], 'codes ' || v_codes::text;
end;
$$;

reset role;
delete from public.recipe_ingredients
 where recipe_version_id = '50000000-0000-0000-0000-000000000002' and sort_order in (4, 5);
-- The drink goes live so price changes have an impact.
update public.recipe_versions set status = 'APPROVED' where id = '50000000-0000-0000-0000-000000000002';
update public.recipes set current_approved_version_id = '50000000-0000-0000-0000-000000000002'
 where id = '40000000-0000-0000-0000-000000000002';

-- Price change: proposal does not change cost until approved -------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);

insert into public.material_price_versions (id, pack_id, price)
  values ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 7.00);
select public.submit_material_price('60000000-0000-0000-0000-000000000001');

do $$
begin
  assert public.material_affected_recipe_count('10000000-0000-0000-0000-000000000001') = 1, 'milk used once';
  -- Sugar is used by the drink through the syrup, and by the syrup itself.
  assert public.material_affected_recipe_count('10000000-0000-0000-0000-000000000003') = 2, 'sugar via prep';
  assert public.packaging_affected_recipe_count('30000000-0000-0000-0000-000000000001') = 1, 'lid used once';
  assert (public.calculate_recipe_cost('50000000-0000-0000-0000-000000000002') ->> 'total_cost')::numeric = 11.843,
    'pending price must not change cost';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select public.approve_material_price('60000000-0000-0000-0000-000000000001');

do $$
declare
  v_superseded integer;
begin
  -- 180 ml x 7.00 / 1000 = 1.26; 11.843 - 1.143 + 1.26 = 11.96.
  assert (public.calculate_recipe_cost('50000000-0000-0000-0000-000000000002') ->> 'total_cost')::numeric = 11.96,
    'approved price must change cost';
  select count(*) into v_superseded from public.material_price_versions
   where pack_id = '20000000-0000-0000-0000-000000000001' and status = 'SUPERSEDED';
  assert v_superseded = 1, 'old price kept as history';
end;
$$;

-- Another outlet's Manager cannot read this recipe's cost.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000c', 'other@test.local');
insert into public.profiles (id, email, full_name, role)
  values ('00000000-0000-0000-0000-00000000000c', 'other@test.local', 'OTHER MANAGER', 'MANAGER');
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000c', id from public.outlets where code = 'KL-CABINET8';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);

do $$
begin
  perform public.calculate_recipe_cost('50000000-0000-0000-0000-000000000002');
  raise exception 'Other outlet should not read cost';
exception when insufficient_privilege then
  null;
end;
$$;

select 'material_cost tests passed' as result;

rollback;
