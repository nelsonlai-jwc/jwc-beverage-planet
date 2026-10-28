-- Admin edits material types, outlets and option names on the Settings page.
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

-- A material that uses the type "Syrup".
insert into public.materials (name, brand, material_type_id, created_by)
  select 'Test Syrup', 'Test', id, '00000000-0000-0000-0000-00000000000b'
    from public.material_types where name = 'Syrup';

set local role authenticated;

-- Manager cannot change anything.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
declare
  v_count integer;
begin
  update public.option_labels set label_zh = 'x' where option_group = 'STYLE' and value = 'TEA';
  get diagnostics v_count = row_count;
  assert v_count = 0, 'manager must not rename options';
  begin
    perform public.remove_setting_value('MATERIAL_TYPE', (select id from public.material_types where name = 'Other'));
    raise exception 'manager should not remove';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
declare
  v_ids text[];
begin
  -- Add and rename.
  insert into public.material_types (name, sort_order) values ('Bitters', 11);
  update public.material_types set name = 'Simple Syrup' where name = 'Syrup';
  insert into public.outlets (code, name) values ('PG-TEST', 'PG - Test');
  update public.outlets set name = 'JB - Brooos' where code = 'JB-BROOOS';

  -- Unused values are deleted; used ones are disabled.
  assert public.remove_setting_value('MATERIAL_TYPE', (select id from public.material_types where name = 'Bitters'))
    = 'DELETED', 'unused type deleted';
  assert public.remove_setting_value('MATERIAL_TYPE', (select id from public.material_types where name = 'Simple Syrup'))
    = 'DISABLED', 'used type disabled';
  assert not (select is_active from public.material_types where name = 'Simple Syrup'), 'type inactive';
  assert public.remove_setting_value('OUTLET', (select id from public.outlets where code = 'PG-TEST'))
    = 'DELETED', 'unused outlet deleted';
  assert public.remove_setting_value('OUTLET', (select id from public.outlets where code = 'JB-BROOOS'))
    = 'DISABLED', 'outlet with a manager disabled';

  -- Option names and order change; values do not.
  update public.option_labels set label_en = 'Iced', label_zh = '冰' where option_group = 'TEMP' and value = 'COLD';
  assert (select label_zh from public.option_labels where option_group = 'TEMP' and value = 'COLD') = '冰', 'renamed';
  begin
    update public.option_labels set value = 'WARM' where option_group = 'TEMP' and value = 'HOT';
    raise exception 'value should be fixed';
  exception when insufficient_privilege then
    null;
  end;
  perform public.reorder_setting_values('TEMP', array['FROZEN', 'COLD', 'HOT']);
  assert (select sort_order from public.option_labels where option_group = 'TEMP' and value = 'FROZEN') = 1, 'reordered';

  select array_agg(id::text order by sort_order desc) into v_ids from public.material_types;
  perform public.reorder_setting_values('MATERIAL_TYPE', v_ids);
  assert (select name from public.material_types order by sort_order limit 1) = 'Other', 'types reordered';
end;
$$;

rollback;
