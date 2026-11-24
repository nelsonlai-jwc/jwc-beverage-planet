-- Feedback #15: Admins correct a user's full name through admin_update_user.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'oa@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'jb@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'kl@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@test.local', 'SUPER ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-0000000000a2', 'oa@test.local', 'OUTLET ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-0000000000b1', 'jb@test.local', 'KHORWEICONG', 'MANAGER'),
  ('00000000-0000-0000-0000-0000000000b2', 'kl@test.local', 'KLMANAGER', 'MANAGER');
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000a1';
insert into public.user_outlets (user_id, outlet_id)
select '00000000-0000-0000-0000-0000000000a2'::uuid, id from public.outlets where code = 'JB-FACTORY30'
union all select '00000000-0000-0000-0000-0000000000b1'::uuid, id from public.outlets where code = 'JB-FACTORY30'
union all select '00000000-0000-0000-0000-0000000000b2'::uuid, id from public.outlets where code = 'KL-COFFEEMAMAK';
set constraints all immediate;

create temp table t_outlet as select code, id from public.outlets;
grant select on t_outlet to authenticated;

set local role authenticated;

-- Super Admin -----------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare
  kl uuid := (select id from t_outlet where code = 'KL-COFFEEMAMAK');
begin
  perform public.admin_update_user('00000000-0000-0000-0000-0000000000b2', 'MANAGER', 'ACTIVE', array[kl], 1,
    '  kl   manager ');
  assert (select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000b2') = 'KL MANAGER',
    'name trimmed, single-spaced and upper-cased';

  -- Leaving the name out keeps it.
  perform public.admin_update_user('00000000-0000-0000-0000-0000000000b2', 'MANAGER', 'ACTIVE', array[kl], 2);
  assert (select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000b2') = 'KL MANAGER',
    'name kept when not given';

  begin
    perform public.admin_update_user('00000000-0000-0000-0000-0000000000b2', 'MANAGER', 'ACTIVE', array[kl], 3, '   ');
    raise exception 'an empty name should fail';
  exception when check_violation then
    assert sqlerrm = 'NAME_INVALID', sqlerrm;
  end;
  begin
    perform public.admin_update_user('00000000-0000-0000-0000-0000000000b2', 'MANAGER', 'ACTIVE', array[kl], 3, 'KL 123');
    raise exception 'digits should fail';
  exception when check_violation then
    assert sqlerrm = 'NAME_INVALID', sqlerrm;
  end;
  begin
    perform public.admin_update_user(auth.uid(), 'ADMIN', 'ACTIVE', '{}', 1, 'NEW NAME');
    raise exception 'renaming the Super Admin should fail';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Outlet Admin ----------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
do $$
declare
  jb uuid := (select id from t_outlet where code = 'JB-FACTORY30');
  kl uuid := (select id from t_outlet where code = 'KL-COFFEEMAMAK');
begin
  perform public.admin_update_user('00000000-0000-0000-0000-0000000000b1', 'MANAGER', 'ACTIVE', array[jb], 1,
    'Khor Wei Cong');
  assert (select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000b1') = 'KHOR WEI CONG',
    'outlet Admin renames a user of their outlet';
  begin
    perform public.admin_update_user('00000000-0000-0000-0000-0000000000b2', 'MANAGER', 'ACTIVE', array[kl], 3,
      'OTHER NAME');
    raise exception 'renaming a KL user should fail';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
