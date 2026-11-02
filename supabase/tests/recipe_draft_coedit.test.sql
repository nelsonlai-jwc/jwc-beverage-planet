-- Managers of any one of a recipe's outlets co-edit its draft.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

-- Users: Admin; Manager MA of JB-BROOOS + JB-YOUBAR; Manager MB of one of them (set below);
-- Manager MK of KL-CABINET8.
alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'ma@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'mb@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', 'mk@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local', 'TEST ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-0000000000a2', 'ma@test.local', 'MANAGER A', 'MANAGER'),
  ('00000000-0000-0000-0000-0000000000a3', 'mb@test.local', 'MANAGER B', 'MANAGER'),
  ('00000000-0000-0000-0000-0000000000a4', 'mk@test.local', 'MANAGER KL', 'MANAGER');
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-0000000000a2', id from public.outlets where code in ('JB-BROOOS', 'JB-YOUBAR');
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-0000000000a4', id from public.outlets where code = 'KL-CABINET8';

set local role authenticated;

-- MA creates a drink for both JB outlets.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
do $$
declare
  v_version uuid;
begin
  v_version := public.create_recipe(
    (select array_agg(id) from public.outlets where code in ('JB-BROOOS', 'JB-YOUBAR')), false, false, 'Shared Latte');
  perform set_config('test.version', v_version::text, true);
  perform set_config('test.recipe', (select recipe_id from public.recipe_versions where id = v_version)::text, true);
end;
$$;

-- MB manages only the outlet that is not the recipe's first outlet.
reset role;
insert into public.user_outlets (user_id, outlet_id)
  select '00000000-0000-0000-0000-0000000000a3', ro.outlet_id
    from public.recipe_outlets ro join public.recipes r on r.id = ro.recipe_id
   where r.id = current_setting('test.recipe')::uuid and ro.outlet_id <> r.outlet_id;
set local role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
do $$
declare
  v_rev integer;
  v_result jsonb;
  v_rows integer;
begin
  assert not private.can_manage_recipe(current_setting('test.recipe')::uuid), 'MB does not manage the recipe';
  assert private.can_edit_recipe_version(current_setting('test.version')::uuid), 'MB co-edits the draft';

  v_rev := public.save_recipe_draft(current_setting('test.version')::uuid, 1, '{"product_name": "Co Latte"}');
  assert v_rev = 2, 'MB saved';
  assert (select product_name from public.recipe_versions where id = current_setting('test.version')::uuid) = 'Co Latte';

  -- A save on an old revision is refused, not silently overwritten.
  begin
    perform public.save_recipe_draft(current_setting('test.version')::uuid, 1, '{"product_name": "Stale"}');
    raise exception 'stale save should fail';
  exception when serialization_failure then
    null;
  end;

  -- Live cost of the draft.
  assert public.calculate_recipe_cost(current_setting('test.version')::uuid) is not null, 'MB sees draft cost';

  -- Submit runs (this empty draft fails validation, which is returned, not refused).
  v_result := public.submit_recipe_version(current_setting('test.version')::uuid, 2);
  assert v_result ? 'errors', 'submit validated';

  -- The approval history of the recipe is visible to MB (return reasons).
  reset role;
  insert into public.approval_events (entity_type, entity_id, outlet_id, action, reason, actor_id)
  select 'RECIPE_VERSION', v.id, r.outlet_id, 'RETURN', 'Too sweet', '00000000-0000-0000-0000-0000000000a1'
    from public.recipe_versions v join public.recipes r on r.id = v.recipe_id
   where v.id = current_setting('test.version')::uuid;
  set local role authenticated;
  assert exists (select 1 from public.approval_events
                  where entity_id = current_setting('test.version')::uuid and reason = 'Too sweet'), 'MB sees return reason';

  -- Deleting stays with Managers of every outlet.
  delete from public.recipe_versions where id = current_setting('test.version')::uuid;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'MB cannot delete the draft';
  delete from public.recipes where id = current_setting('test.recipe')::uuid;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'MB cannot delete the recipe';
end;
$$;

-- MK (KL) manages none of its outlets.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', true);
do $$
begin
  assert not private.can_edit_recipe_version(current_setting('test.version')::uuid), 'MK cannot edit';
  begin
    perform public.submit_recipe_version(current_setting('test.version')::uuid, 2);
    raise exception 'MK cannot submit';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

-- All-outlet recipes stay Admin only.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
begin
  perform set_config('test.all_version', public.create_recipe(null, true, false, 'House Latte')::text, true);
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
do $$
begin
  assert not private.can_edit_recipe_version(current_setting('test.all_version')::uuid), 'MB cannot edit all-outlet';
end;
$$;

rollback;
