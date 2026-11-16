-- Admin adds a beverage style on the Settings page. Runs in one transaction and rolls back.
-- Run with psql -v ON_ERROR_STOP=1.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local', 'TEST ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local', 'TEST MANAGER', 'MANAGER');

set local role authenticated;

-- Manager cannot add a style.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  perform public.add_beverage_style('Chocolate', '巧克力');
  raise exception 'manager should not add a style';
exception when insufficient_privilege then
  null;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
begin
  assert public.add_beverage_style(' Chocolate ', '巧克力') = 'CHOCOLATE', 'value from English name';
  assert (select sort_order from public.option_labels where option_group = 'STYLE' and value = 'CHOCOLATE')
    = (select max(sort_order) from public.option_labels where option_group = 'STYLE'), 'added at the end';
  assert (select label_zh from public.option_labels where option_group = 'STYLE' and value = 'CHOCOLATE') = '巧克力',
    'names saved';
  assert public.add_beverage_style('Hot Choc!', '热巧') = 'HOT_CHOC', 'spaces and symbols become _';

  -- Same name (either language) is a duplicate.
  begin
    perform public.add_beverage_style('chocolate', '可可');
    raise exception 'duplicate English name should fail';
  exception when unique_violation then
    null;
  end;
  begin
    perform public.add_beverage_style('Cocoa', '茶');
    raise exception 'duplicate Chinese name should fail';
  exception when unique_violation then
    null;
  end;
  -- A different name that gives a value already used gets a number.
  assert public.add_beverage_style('Coffee!', '咖啡二') = 'COFFEE_2', 'value made unique';
  begin
    perform public.add_beverage_style('', '空');
    raise exception 'empty name should fail';
  exception when check_violation then
    null;
  end;
end;
$$;

rollback;
