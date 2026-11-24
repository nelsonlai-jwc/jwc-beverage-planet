-- JWC shop coffee bean sync and the raw material "Unavailable" setting.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'outlet-admin@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local', 'TEST ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local', 'TEST MANAGER', 'MANAGER');
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000b', id from public.outlets where code = 'JB-BROOOS';
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-00000000000a';
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000c', 'outlet-admin@test.local', 'TEST OUTLET ADMIN', 'ADMIN');
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000c', id from public.outlets where code = 'JB-BROOOS';

insert into public.material_types (name, sort_order)
  select 'Coffee Bean', 99 where not exists (select 1 from public.material_types where name = 'Coffee Bean');

-- An existing approved bean (made by the Super Admin through the CSV import).
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select public.import_materials(jsonb_build_array(jsonb_build_object(
  'name', 'JWC Signature Blend - Caramel Popcorn 1kg', 'brand', 'JWC Roastery', 'no_brand', false,
  'material_type_id', (select id from public.material_types where name = 'Coffee Bean'),
  'pack_quantity', 1000, 'unit', 'g', 'price', 116)), true);

-- A Manager cannot sync or switch availability.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  perform public.sync_shop_beans('[]', '[]', '[]');
  raise exception 'manager should not sync';
exception when insufficient_privilege then
  null;
end;
$$;
do $$
begin
  perform public.set_material_unavailable(
    (select id from public.materials where name = 'JWC Signature Blend - Caramel Popcorn 1kg'), true);
  raise exception 'manager should not switch availability';
exception when insufficient_privilege then
  null;
end;
$$;

-- An outlet Admin cannot sync, but can switch availability.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
begin
  perform public.sync_shop_beans('[]', '[]', '[]');
  raise exception 'outlet admin should not sync';
exception when insufficient_privilege then
  null;
end;
$$;
select public.set_material_unavailable(
  (select id from public.materials where name = 'JWC Signature Blend - Caramel Popcorn 1kg'), true);
do $$
begin
  assert (select unavailable from public.materials where name = 'JWC Signature Blend - Caramel Popcorn 1kg');
end;
$$;

-- Super Admin sync: link the existing bean (shop says available), add two new sizes, one sold out.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
declare
  v_result jsonb;
begin
  v_result := public.sync_shop_beans(
    jsonb_build_array(jsonb_build_object(
      'material_id', (select id from public.materials where name = 'JWC Signature Blend - Caramel Popcorn 1kg'),
      'variant_id', 101)),
    jsonb_build_array(
      jsonb_build_object('variant_id', 102, 'name', 'JWC Signature Blend - Caramel Popcorn 200g',
                         'grams', 200, 'price', 28, 'espresso', true, 'filter', false),
      jsonb_build_object('variant_id', 201, 'name', 'JWC Single Origin Filter - Kenya AB Washed 200g',
                         'grams', 200, 'price', 44, 'espresso', false, 'filter', true)),
    jsonb_build_array(
      jsonb_build_object('variant_id', 101, 'available', true),
      jsonb_build_object('variant_id', 102, 'available', true),
      jsonb_build_object('variant_id', 201, 'available', false)));
  assert v_result = '{"linked": 1, "created": 2, "unavailable": 1, "available": 1}'::jsonb, v_result::text;

  assert (select status from public.materials where shop_variant_id = 102) = 'APPROVED';
  assert (select brand from public.materials where shop_variant_id = 102) = 'JWC Roastery';
  assert (select espresso_calibration and not filter_calibration from public.materials where shop_variant_id = 102);
  assert (select p.status = 'APPROVED' and p.pack_quantity = 200 and p.unit = 'g'
            from public.materials m join public.material_packs p on p.id = m.cost_pack_id
           where m.shop_variant_id = 102);
  assert (select pv.price from public.materials m
            join public.material_price_versions pv on pv.pack_id = m.cost_pack_id and pv.status = 'APPROVED'
           where m.shop_variant_id = 102) = 28;
  assert (select unavailable from public.materials where shop_variant_id = 201);
  assert not (select unavailable from public.materials where shop_variant_id = 101);

  -- Running it again adds nothing; a size gone from the shop becomes unavailable.
  v_result := public.sync_shop_beans(
    '[]',
    jsonb_build_array(
      jsonb_build_object('variant_id', 102, 'name', 'JWC Signature Blend - Caramel Popcorn 200g',
                         'grams', 200, 'price', 28, 'espresso', true, 'filter', false)),
    jsonb_build_array(
      jsonb_build_object('variant_id', 101, 'available', true),
      jsonb_build_object('variant_id', 201, 'available', true)));
  assert v_result = '{"linked": 0, "created": 0, "unavailable": 1, "available": 1}'::jsonb, v_result::text;
  assert (select unavailable from public.materials where shop_variant_id = 102);
  assert not (select unavailable from public.materials where shop_variant_id = 201);
  assert (select count(*) from public.materials where name like 'JWC Signature Blend - Caramel Popcorn%') = 2;
end;
$$;

-- An API caller still cannot change an approved material directly.
do $$
begin
  update public.materials set unavailable = true where shop_variant_id = 101;
  raise exception 'approved material should not be updated directly';
exception when insufficient_privilege then
  null;
end;
$$;

rollback;
