-- Drink names without temperature: same outlet, same name + temperature is refused.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'super@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'super@test.local', 'TEST SUPER', 'ADMIN'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local', 'TEST MANAGER', 'MANAGER');
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-00000000000a';

-- 1: approved "Matcha Latte" COLD at Brooos.
-- 2..6: drafts: same name COLD at Brooos, HOT at Brooos, COLD at You Bar, COLD for all outlets,
--       and a Prep with the same name at Brooos.
insert into public.recipes (id, outlet_id, is_prep, all_outlets, created_by)
  select r.id, o.id, r.is_prep, r.all_outlets, '00000000-0000-0000-0000-00000000000b'
    from (values ('40000000-0000-0000-0000-000000000001'::uuid, 'JB-BROOOS', false, false),
                 ('40000000-0000-0000-0000-000000000002', 'JB-BROOOS', false, false),
                 ('40000000-0000-0000-0000-000000000003', 'JB-BROOOS', false, false),
                 ('40000000-0000-0000-0000-000000000004', 'JB-YOUBAR', false, false),
                 ('40000000-0000-0000-0000-000000000005', 'JB-BROOOS', false, true),
                 ('40000000-0000-0000-0000-000000000006', 'JB-BROOOS', true, false)) as r (id, code, is_prep, all_outlets)
    join public.outlets o on o.code = r.code;
delete from public.recipe_outlets where recipe_id = '40000000-0000-0000-0000-000000000005';
insert into public.recipe_versions (id, recipe_id, version_no, status, product_name, style, temperature, created_by)
values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 'APPROVED',
   'Matcha Latte', 'TEA', 'COLD', '00000000-0000-0000-0000-00000000000b'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 1, 'DRAFT',
   ' matcha  LATTE', 'TEA', 'COLD', '00000000-0000-0000-0000-00000000000b'),
  ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', 1, 'DRAFT',
   'Matcha Latte', 'TEA', 'HOT', '00000000-0000-0000-0000-00000000000b'),
  ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', 1, 'DRAFT',
   'Matcha Latte', 'TEA', 'COLD', '00000000-0000-0000-0000-00000000000b'),
  ('50000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000005', 1, 'DRAFT',
   'Matcha Latte', 'TEA', 'COLD', '00000000-0000-0000-0000-00000000000b'),
  ('50000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000006', 1, 'DRAFT',
   'Matcha Latte', 'PREP_MATERIAL', 'COLD', '00000000-0000-0000-0000-00000000000b');
update public.recipes set current_approved_version_id = '50000000-0000-0000-0000-000000000001'
 where id = '40000000-0000-0000-0000-000000000001';

create function pg_temp.dup(p uuid) returns boolean language sql as $$
  select private.validate_recipe_version(p) @> '[{"code": "DUPLICATE_NAME"}]';
$$;

do $$
begin
  assert pg_temp.dup('50000000-0000-0000-0000-000000000002'), 'same outlet, same name and temperature';
  assert not pg_temp.dup('50000000-0000-0000-0000-000000000003'), 'other temperature is a different drink';
  assert not pg_temp.dup('50000000-0000-0000-0000-000000000004'), 'other outlet may use the same name';
  assert pg_temp.dup('50000000-0000-0000-0000-000000000005'), 'all outlets includes Brooos';
  assert not pg_temp.dup('50000000-0000-0000-0000-000000000006'), 'Preps are not checked';
  assert not pg_temp.dup('50000000-0000-0000-0000-000000000001'), 'a recipe does not clash with itself';
end;
$$;

-- A pending version counts too: recipe 4 (You Bar) is pending, recipe 1 moves to You Bar.
update public.recipe_versions set status = 'PENDING' where id = '50000000-0000-0000-0000-000000000004';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
begin
  perform public.set_recipe_outlets('40000000-0000-0000-0000-000000000001',
    array[(select id from public.outlets where code = 'JB-YOUBAR')], false);
  raise exception 'moving into an outlet with the same drink should fail';
exception when unique_violation then
  assert sqlerrm = 'DUPLICATE_NAME', sqlerrm;
end;
$$;
-- Another outlet is fine.
select public.set_recipe_outlets('40000000-0000-0000-0000-000000000001',
  array[(select id from public.outlets where code = 'KL-COFFEEMAMAK')], false);

rollback;
