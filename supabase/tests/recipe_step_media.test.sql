-- Photo or video on a Processing Method step; appearance photos stay images.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000b', 'manager@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local', 'TEST MANAGER', 'MANAGER');
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-00000000000b', id from public.outlets where code = 'JB-BROOOS';
insert into public.recipes (id, outlet_id, is_prep, created_by)
  select '40000000-0000-0000-0000-000000000001', id, false, '00000000-0000-0000-0000-00000000000b'
    from public.outlets where code = 'JB-BROOOS';
insert into public.recipe_versions (id, recipe_id, version_no, status, product_name, style, temperature, created_by)
values ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 'DRAFT',
        'Iced Latte', 'COFFEE', 'COLD', '00000000-0000-0000-0000-00000000000b');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);

-- A 40 MB video and a photo are accepted; oversized files are not.
insert into public.media_assets (id, object_path, mime_type, size_bytes, upload_status) values
  ('70000000-0000-0000-0000-000000000001', 'x/step.mp4', 'video/mp4', 41943040, 'READY'),
  ('70000000-0000-0000-0000-000000000002', 'x/step.mov', 'video/quicktime', 1000, 'READY'),
  ('70000000-0000-0000-0000-000000000003', 'x/photo.jpg', 'image/jpeg', 1000, 'READY');
do $$
begin
  begin
    insert into public.media_assets (object_path, mime_type, size_bytes) values ('x/big.mp4', 'video/mp4', 52428801);
    raise exception 'video over 50 MB should be rejected';
  exception when check_violation then null;
  end;
  begin
    insert into public.media_assets (object_path, mime_type, size_bytes) values ('x/big.jpg', 'image/jpeg', 10485761);
    raise exception 'photo over 10 MB should be rejected';
  exception when check_violation then null;
  end;
end;
$$;

-- Steps keep their photo or video through a draft save.
select public.save_recipe_draft('50000000-0000-0000-0000-000000000001',
  (select revision from public.recipe_versions where id = '50000000-0000-0000-0000-000000000001'),
  jsonb_build_object('product_name', 'Iced Latte', 'style', 'COFFEE', 'temperature', 'COLD',
    'ingredients', '[]'::jsonb, 'packaging', '[]'::jsonb,
    'steps', jsonb_build_array(
      jsonb_build_object('instruction', 'Pull a shot', 'media_asset_id', '70000000-0000-0000-0000-000000000001'),
      jsonb_build_object('instruction', 'Pour milk', 'media_asset_id', '70000000-0000-0000-0000-000000000003'),
      jsonb_build_object('instruction', 'Serve', 'media_asset_id', null)),
    'photos', jsonb_build_array('70000000-0000-0000-0000-000000000003')));
do $$
begin
  assert (select count(*) from public.recipe_steps
           where recipe_version_id = '50000000-0000-0000-0000-000000000001' and media_asset_id is not null) = 2,
         'two steps should carry media';
end;
$$;

-- A video cannot be an appearance photo.
do $$
begin
  begin
    perform public.save_recipe_draft('50000000-0000-0000-0000-000000000001',
      (select revision from public.recipe_versions where id = '50000000-0000-0000-0000-000000000001'),
      jsonb_build_object('product_name', 'Iced Latte', 'ingredients', '[]'::jsonb, 'packaging', '[]'::jsonb,
        'steps', '[]'::jsonb, 'photos', jsonb_build_array('70000000-0000-0000-0000-000000000002')));
    raise exception 'video as appearance photo should be rejected';
  exception when check_violation then null;
  end;
end;
$$;

rollback;
