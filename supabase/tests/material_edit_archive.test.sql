-- Editing, archiving, restoring, deleting and importing materials and packaging.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

-- Users: one Admin, two Managers.
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
  select u, id from public.outlets,
    unnest(array['00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c']::uuid[]) u
   where code = 'JB-BROOOS';

-- Manager B registers two materials and a lid -------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);

insert into public.materials (id, name, brand, material_type_id)
  select '10000000-0000-0000-0000-000000000001', 'Fresh Milk', 'Test Dairy', id
    from public.material_types where name = 'Other';
insert into public.materials (id, name, brand, material_type_id)
  select '10000000-0000-0000-0000-000000000002', 'Oat Milk', 'Test Oats', id
    from public.material_types where name = 'Other';
insert into public.material_packs (id, material_id, pack_quantity, unit) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1000, 'ml'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 1000, 'ml');
insert into public.material_price_versions (pack_id, price) values
  ('20000000-0000-0000-0000-000000000001', 6.35),
  ('20000000-0000-0000-0000-000000000002', 9.90);
insert into public.packaging_items (id, name) values ('30000000-0000-0000-0000-000000000001', 'Cup Lid');

-- Manager C cannot edit, submit or delete B's drafts.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
declare
  v_count integer;
begin
  update public.materials set description = 'changed' where id = '10000000-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  assert v_count = 0, 'other manager must not edit the draft';
  begin
    perform public.submit_material('10000000-0000-0000-0000-000000000001');
    raise exception 'other manager should not submit';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.delete_material_draft('10000000-0000-0000-0000-000000000001');
    raise exception 'other manager should not delete';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

-- B deletes the lid draft, then submits the milks.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
select public.delete_packaging_draft('30000000-0000-0000-0000-000000000001');
do $$
begin
  assert not exists (select 1 from public.packaging_items where id = '30000000-0000-0000-0000-000000000001'),
    'draft deleted';
end;
$$;
select public.submit_material('10000000-0000-0000-0000-000000000001');
select public.submit_material('10000000-0000-0000-0000-000000000002');

do $$
begin
  perform public.delete_material_draft('10000000-0000-0000-0000-000000000001');
  raise exception 'submitted material should not be deletable';
exception when invalid_parameter_value then
  assert sqlerrm = 'NOT_DELETABLE', sqlerrm;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select public.approve_material('10000000-0000-0000-0000-000000000001');
select public.approve_material('10000000-0000-0000-0000-000000000002');

-- Admin edits an approved material directly ---------------------------------
do $$
begin
  assert public.request_change('MATERIAL', '10000000-0000-0000-0000-000000000001', 'EDIT',
    '{"name": "Fresh Milk Full Cream", "abv": null, "status": "DRAFT"}') = 'APPLIED', 'admin edit applied';
  assert (select name from public.materials where id = '10000000-0000-0000-0000-000000000001')
    = 'Fresh Milk Full Cream', 'name changed';
  assert (select status from public.materials where id = '10000000-0000-0000-0000-000000000001')
    = 'APPROVED', 'status is not an editable field';
  assert (select old_values ->> 'name' from public.change_requests
           where entity_id = '10000000-0000-0000-0000-000000000001') = 'Fresh Milk', 'old value kept';
end;
$$;

-- Manager edit is a request; it changes nothing until approved ---------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  assert public.request_change('MATERIAL', '10000000-0000-0000-0000-000000000001', 'EDIT',
    '{"description": "Keep cold"}') = 'REQUESTED', 'manager edit requested';
  assert (select description from public.materials where id = '10000000-0000-0000-0000-000000000001') is null,
    'not applied yet';
  begin
    perform public.request_change('MATERIAL', '10000000-0000-0000-0000-000000000001', 'EDIT',
      '{"description": "Again"}');
    raise exception 'second request should fail';
  exception when invalid_parameter_value then
    assert sqlerrm = 'REQUEST_ALREADY_PENDING', sqlerrm;
  end;
  -- A rename onto an existing product is refused at once.
  begin
    perform public.request_change('MATERIAL', '10000000-0000-0000-0000-000000000002', 'EDIT',
      '{"name": "Fresh Milk Full Cream", "brand": "Test Dairy"}');
    raise exception 'duplicate rename should fail';
  exception when unique_violation then
    null;
  end;
  assert (select name from public.materials where id = '10000000-0000-0000-0000-000000000002') = 'Oat Milk',
    'dry run rolled back';
  begin
    perform public.request_change('MATERIAL', '10000000-0000-0000-0000-000000000002', 'ARCHIVE', null, ' ');
    raise exception 'archive request needs a reason';
  exception when invalid_parameter_value then
    assert sqlerrm = 'REASON_REQUIRED', sqlerrm;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select public.review_change_request(
  (select id from public.change_requests where status = 'PENDING'), true);
do $$
begin
  assert (select description from public.materials where id = '10000000-0000-0000-0000-000000000001')
    = 'Keep cold', 'applied on approval';
end;
$$;

-- Archiving: blocked while a live recipe uses it --------------------------------
reset role;
insert into public.recipes (id, outlet_id, is_prep)
  select '40000000-0000-0000-0000-000000000001', id, false from public.outlets where code = 'JB-BROOOS';
insert into public.recipe_versions (id, recipe_id, version_no, status, product_name, created_by)
values ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 'APPROVED',
        'Latte', '00000000-0000-0000-0000-00000000000b');
update public.recipes set current_approved_version_id = '50000000-0000-0000-0000-000000000001'
 where id = '40000000-0000-0000-0000-000000000001';
insert into public.recipe_ingredients (recipe_version_id, sort_order, material_id, quantity, unit) values
  ('50000000-0000-0000-0000-000000000001', 1, '10000000-0000-0000-0000-000000000001', 180, 'ml');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
declare
  v record;
begin
  begin
    perform public.request_change('MATERIAL', '10000000-0000-0000-0000-000000000001', 'ARCHIVE');
    raise exception 'material in use should not archive';
  exception when invalid_parameter_value then
    assert sqlerrm = 'IN_USE', sqlerrm;
  end;
  select * into v from public.item_usage('10000000-0000-0000-0000-000000000001', null);
  assert v.product_name = 'Latte' and v.usage = 'LIVE', 'usage lists the latte';
end;
$$;

-- Manager requests archiving of an unused material; Admin approves; Admin restores.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  assert public.request_change('MATERIAL', '10000000-0000-0000-0000-000000000002', 'ARCHIVE', null,
    'Supplier stopped') = 'REQUESTED', 'archive requested';
  assert (select status from public.materials where id = '10000000-0000-0000-0000-000000000002') = 'APPROVED',
    'still approved';
  begin
    perform public.restore_archived('MATERIAL', '10000000-0000-0000-0000-000000000002');
    raise exception 'manager should not restore';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
begin
  begin
    perform public.review_change_request(
      (select id from public.change_requests where status = 'PENDING'), false, '');
    raise exception 'return needs a reason';
  exception when invalid_parameter_value then
    null;
  end;
  perform public.review_change_request((select id from public.change_requests where status = 'PENDING'), true);
  assert (select status from public.materials where id = '10000000-0000-0000-0000-000000000002') = 'ARCHIVED',
    'archived';
  perform public.restore_archived('MATERIAL', '10000000-0000-0000-0000-000000000002');
  assert (select status from public.materials where id = '10000000-0000-0000-0000-000000000002') = 'APPROVED',
    'restored';
  assert (select count(*) from public.item_change_log('MATERIAL', '10000000-0000-0000-0000-000000000002')) > 5,
    'change log has entries';
end;
$$;

-- Import ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
declare
  v_type uuid := (select id from public.material_types where name = 'Syrup');
begin
  begin
    perform public.import_materials('[]', true);
    raise exception 'manager cannot import as approved';
  exception when insufficient_privilege then
    null;
  end;
  assert public.import_materials(jsonb_build_array(
    jsonb_build_object('name', 'Vanilla Syrup', 'brand', 'Test Syrups', 'no_brand', false,
      'material_type_id', v_type, 'pack_quantity', 750, 'unit', 'ml', 'price', 32.5),
    jsonb_build_object('name', 'House Syrup', 'no_brand', true,
      'material_type_id', v_type, 'pack_quantity', 1000, 'unit', 'ml')
  )) = 2, 'imported two';
  assert (select count(*) from public.materials where name in ('Vanilla Syrup', 'House Syrup') and status = 'DRAFT') = 2,
    'imported as drafts';
  -- One duplicate row and nothing is imported.
  begin
    perform public.import_materials(jsonb_build_array(
      jsonb_build_object('name', 'Caramel Syrup', 'no_brand', true,
        'material_type_id', v_type, 'pack_quantity', 1, 'unit', 'ml'),
      jsonb_build_object('name', 'vanilla  syrup', 'brand', 'TEST SYRUPS', 'no_brand', false,
        'material_type_id', v_type, 'pack_quantity', 1, 'unit', 'ml')));
    raise exception 'duplicate import should fail';
  exception when unique_violation then
    null;
  end;
  assert not exists (select 1 from public.materials where name = 'Caramel Syrup'), 'all or nothing';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
begin
  assert public.import_packaging_items('[{"name": "Straw", "price": 0.05}]', true) = 1, 'packaging imported';
  assert (select status from public.packaging_items where name = 'Straw') = 'APPROVED', 'approved at once';
end;
$$;

select 'material_edit_archive tests passed' as result;

rollback;
