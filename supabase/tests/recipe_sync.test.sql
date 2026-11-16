-- Same-name recipe sync (Super Admin only).
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'super@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'outletadmin@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'super@test.local', 'TEST SUPER', 'ADMIN'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local', 'TEST MANAGER', 'MANAGER'),
  ('00000000-0000-0000-0000-00000000000c', 'outletadmin@test.local', 'OUTLET ADMIN', 'ADMIN');
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-00000000000a';
insert into public.user_outlets (user_id, outlet_id)
  select u.id, o.id from public.outlets o,
    (values ('00000000-0000-0000-0000-00000000000b'::uuid), ('00000000-0000-0000-0000-00000000000c')) as u (id)
   where o.code in ('JB-BROOOS', 'JB-YOUBAR');

-- Approved "Iced Latte" at two outlets, "iced  latte " at a third (same name after
-- ignoring case and spaces), a different drink, and a Prep with the same name.
insert into public.recipes (id, outlet_id, is_prep, created_by)
  select r.id, o.id, r.is_prep, '00000000-0000-0000-0000-00000000000b'
    from (values ('40000000-0000-0000-0000-000000000001'::uuid, 'JB-BROOOS', false),
                 ('40000000-0000-0000-0000-000000000002', 'JB-YOUBAR', false),
                 ('40000000-0000-0000-0000-000000000003', 'JB-BROOOS', false),
                 ('40000000-0000-0000-0000-000000000004', 'JB-BROOOS', false),
                 ('40000000-0000-0000-0000-000000000005', 'JB-BROOOS', true)) as r (id, code, is_prep)
    join public.outlets o on o.code = r.code;
insert into public.recipe_versions (id, recipe_id, version_no, status, product_name, style, temperature,
                                    yield_quantity, yield_unit, created_by)
values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 'APPROVED',
   'Iced Latte', 'COFFEE', 'COLD', null, null, '00000000-0000-0000-0000-00000000000b'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 1, 'APPROVED',
   'iced  latte ', 'COFFEE', 'COLD', null, null, '00000000-0000-0000-0000-00000000000b'),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', 1, 'APPROVED',
   'Iced Latte', 'COFFEE', 'COLD', null, null, '00000000-0000-0000-0000-00000000000b'),
  ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', 1, 'APPROVED',
   'Hot Latte', 'COFFEE', 'HOT', null, null, '00000000-0000-0000-0000-00000000000b'),
  ('50000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000005', 1, 'APPROVED',
   'Iced Latte', 'PREP_MATERIAL', null, 500, 'ml', '00000000-0000-0000-0000-00000000000b');
update public.recipes r set current_approved_version_id = v.id
  from public.recipe_versions v
 where v.recipe_id = r.id and v.status = 'APPROVED';
-- Recipe 3 has a draft.
insert into public.recipe_versions (id, recipe_id, version_no, status, product_name, style, temperature, created_by)
values ('50000000-0000-0000-0000-000000000013', '40000000-0000-0000-0000-000000000003', 2, 'DRAFT',
        'Iced Latte', 'COFFEE', 'COLD', '00000000-0000-0000-0000-00000000000b');

set local role authenticated;

create temp table sync_content as
  select jsonb_build_object(
    'style', 'COFFEE', 'temperature', 'COLD', 'change_summary', 'Unified',
    'ingredients', jsonb_build_array(),
    'steps', jsonb_build_array(jsonb_build_object('instruction', 'Pour over ice'))) as c;
grant select on sync_content to authenticated;

-- A Manager and an outlet Admin cannot sync.
do $$
declare
  u uuid;
begin
  foreach u in array array['00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c']::uuid[] loop
    perform set_config('request.jwt.claim.sub', u::text, true);
    begin
      perform public.sync_recipes(
        array['40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002']::uuid[],
        (select c from sync_content));
      raise exception 'only the Super Admin can sync';
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
begin
  begin
    perform public.sync_recipes(array['40000000-0000-0000-0000-000000000001']::uuid[], (select c from sync_content));
    raise exception 'one recipe is not enough';
  exception when check_violation then
    assert sqlerrm = 'SYNC_NEED_TWO', sqlerrm;
  end;
  begin
    perform public.sync_recipes(
      array['40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004']::uuid[],
      (select c from sync_content));
    raise exception 'different names';
  exception when check_violation then
    assert sqlerrm = 'SYNC_NOT_SAME_NAME', sqlerrm;
  end;
  begin
    perform public.sync_recipes(
      array['40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000005']::uuid[],
      (select c from sync_content));
    raise exception 'drink and Prep are not mixed';
  exception when check_violation then
    assert sqlerrm = 'SYNC_NOT_SAME_NAME', sqlerrm;
  end;
  begin
    perform public.sync_recipes(
      array['40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003']::uuid[],
      (select c from sync_content));
    raise exception 'recipe with a draft';
  exception when check_violation then
    assert sqlerrm = 'SYNC_OPEN_VERSION', sqlerrm;
  end;
end;
$$;

-- Same name after ignoring case and spaces, but the content is invalid (no ingredients,
-- no photo): the first recipe fails, its id is reported and nothing is changed.
do $$
declare
  v_detail text;
begin
  perform public.sync_recipes(
    array['40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002']::uuid[],
    (select c from sync_content));
  raise exception 'invalid content should fail';
exception when check_violation then
  get stacked diagnostics v_detail = pg_exception_detail;
  assert sqlerrm = 'RECIPE_INVALID', sqlerrm;
  assert (v_detail::jsonb ->> 'recipe_id') = '40000000-0000-0000-0000-000000000001', v_detail;
  assert (v_detail::jsonb ->> 'detail')::jsonb @> '[{"code": "INGREDIENT_REQUIRED"}]', v_detail;
end;
$$;
do $$
begin
  assert (select count(*) from public.recipe_versions
           where recipe_id in ('40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002')) = 2,
         'no new versions left behind';
  assert (select current_approved_version_id from public.recipes
           where id = '40000000-0000-0000-0000-000000000001') = '50000000-0000-0000-0000-000000000001';
end;
$$;

-- Success: a priced material and a finished photo on both recipes, then sync.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
insert into public.materials (id, name, brand, material_type_id)
  select '10000000-0000-0000-0000-000000000001', 'Fresh Milk', 'Test Dairy', id
    from public.material_types where name = 'Other';
insert into public.material_packs (id, material_id, pack_quantity, unit) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1000, 'ml');
insert into public.material_price_versions (id, pack_id, price) values
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 6.00);
select public.submit_material('10000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select public.approve_material('10000000-0000-0000-0000-000000000001');

reset role;
insert into public.media_assets (id, object_path, mime_type, size_bytes, upload_status) values
  ('70000000-0000-0000-0000-000000000001', 'x/latte.jpg', 'image/jpeg', 1000, 'READY');
insert into storage.objects (bucket_id, name)
  select bucket, object_path from public.media_assets where id = '70000000-0000-0000-0000-000000000001';
insert into public.recipe_media (recipe_version_id, sort_order, media_asset_id) values
  ('50000000-0000-0000-0000-000000000001', 1, '70000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', 1, '70000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);

select public.sync_recipes(
  array['40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002']::uuid[],
  jsonb_build_object(
    'style', 'COFFEE', 'temperature', 'COLD', 'cup_type', '16oz cup', 'change_summary', 'Unified',
    'ingredients', jsonb_build_array(jsonb_build_object(
      'material_id', '10000000-0000-0000-0000-000000000001', 'quantity', 200, 'unit', 'ml', 'notes', '')),
    'steps', jsonb_build_array(jsonb_build_object('instruction', 'Pour [A] over ice'),
                               jsonb_build_object('instruction', '  '),
                               jsonb_build_object('instruction', 'Stir'))));
do $$
declare
  r record;
begin
  for r in
    select v.* from public.recipes rc join public.recipe_versions v on v.id = rc.current_approved_version_id
     where rc.id in ('40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002')
  loop
    assert r.version_no = 2 and r.status = 'APPROVED', 'new approved V2';
    assert r.cup_type = '16oz cup' and r.change_summary = 'Unified';
    -- Each recipe keeps its own name and photos.
    assert r.product_name = case when r.recipe_id = '40000000-0000-0000-0000-000000000001' then 'Iced Latte' else 'iced  latte ' end;
    assert (select count(*) from public.recipe_media where recipe_version_id = r.id) = 1, 'photo kept';
    assert (select quantity from public.recipe_ingredients where recipe_version_id = r.id) = 200;
    assert (select array_agg(instruction order by step_no) from public.recipe_steps where recipe_version_id = r.id)
           = array['Pour [A] over ice', 'Stir'], 'blank step dropped, numbered 1..2';
  end loop;
  assert (select status from public.recipe_versions where id = '50000000-0000-0000-0000-000000000001') = 'SUPERSEDED';
  assert (select status from public.recipe_versions where id = '50000000-0000-0000-0000-000000000002') = 'SUPERSEDED';
end;
$$;

rollback;
