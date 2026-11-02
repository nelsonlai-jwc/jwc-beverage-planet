-- Copy a recipe's in-progress version, into the same outlet or another one.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

-- Users: Admin; Manager M1 of JB-BROOOS.
alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@copy.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'm1@copy.test');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@copy.test', 'COPY ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-0000000000b1', 'm1@copy.test', 'COPY MANAGER', 'MANAGER');
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-0000000000b1', id from public.outlets where code = 'JB-BROOOS';

set local role authenticated;

-- M1 drafts a Prep and a drink that uses it; neither is approved -------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$
declare
  v_prep uuid;
  v_drink uuid;
begin
  v_prep := public.create_recipe(
    (select array_agg(id) from public.outlets where code = 'JB-BROOOS'), false, true, 'Brooos Syrup');
  v_drink := public.create_recipe(
    (select array_agg(id) from public.outlets where code = 'JB-BROOOS'), false, false, 'Draft Latte');
  perform set_config('test.prep', (select recipe_id from public.recipe_versions where id = v_prep)::text, true);
  perform set_config('test.drink', (select recipe_id from public.recipe_versions where id = v_drink)::text, true);
  perform set_config('test.drink_version', v_drink::text, true);
  insert into public.recipe_ingredients (recipe_version_id, sort_order, prep_recipe_id, quantity, unit)
  values (v_drink, 1, current_setting('test.prep')::uuid, 20, 'ml');
end;
$$;

do $$
declare
  v_result jsonb;
  v_new uuid;
begin
  -- Without a version only an approved recipe can be copied, as before.
  begin
    perform public.copy_recipe(current_setting('test.drink')::uuid,
      (select id from public.outlets where code = 'JB-BROOOS'), 'X', '{}', null);
    raise exception 'a never-approved recipe needs its draft version named';
  exception when check_violation then
    null;
  end;

  -- The draft copies into the same outlet; the outlet's own Prep is kept, not copied.
  v_result := public.copy_recipe(current_setting('test.drink')::uuid,
    (select id from public.outlets where code = 'JB-BROOOS'), 'Draft Latte Oat', '{}', 'k1',
    current_setting('test.drink_version')::uuid);
  v_new := (v_result ->> 'recipe_id')::uuid;
  assert (select product_name from public.recipe_versions where recipe_id = v_new) = 'Draft Latte Oat', 'new name';
  assert (select status from public.recipe_versions where recipe_id = v_new) = 'DRAFT', 'copy is a draft';
  assert (select ri.prep_recipe_id from public.recipe_ingredients ri
            join public.recipe_versions v on v.id = ri.recipe_version_id
           where v.recipe_id = v_new) = current_setting('test.prep')::uuid, 'Prep reused';

  -- A version of another recipe is refused.
  begin
    perform public.copy_recipe(current_setting('test.prep')::uuid,
      (select id from public.outlets where code = 'JB-BROOOS'), 'X', '{}', null,
      current_setting('test.drink_version')::uuid);
    raise exception 'version must belong to the recipe';
  exception when check_violation then
    null;
  end;
end;
$$;

-- Into another outlet, an unapproved Prep cannot be copied; mapping it works ---------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare
  v_kl_prep uuid;
  v_result jsonb;
begin
  begin
    perform public.copy_recipe(current_setting('test.drink')::uuid,
      (select id from public.outlets where code = 'KL-CABINET8'), 'KL Latte', '{}', null,
      current_setting('test.drink_version')::uuid);
    raise exception 'an unapproved Prep cannot be copied';
  exception when check_violation then
    null;
  end;

  v_kl_prep := public.create_recipe(
    (select array_agg(id) from public.outlets where code = 'KL-CABINET8'), false, true, 'KL Syrup');
  v_kl_prep := (select recipe_id from public.recipe_versions where id = v_kl_prep);
  v_result := public.copy_recipe(current_setting('test.drink')::uuid,
    (select id from public.outlets where code = 'KL-CABINET8'), 'KL Latte',
    jsonb_build_object(current_setting('test.prep'), v_kl_prep), null,
    current_setting('test.drink_version')::uuid);
  assert (select ri.prep_recipe_id from public.recipe_ingredients ri
            join public.recipe_versions v on v.id = ri.recipe_version_id
           where v.recipe_id = (v_result ->> 'recipe_id')::uuid) = v_kl_prep, 'Prep mapped';
end;
$$;

rollback;
