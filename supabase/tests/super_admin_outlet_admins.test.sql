-- Super Admin is protected; outlet Admins manage only users and requests of their outlets.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'oa@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'jb@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'kl@test.local'),
  ('00000000-0000-0000-0000-0000000000b3', 'both@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@test.local', 'SUPER ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-0000000000a2', 'oa@test.local', 'OUTLET ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-0000000000b1', 'jb@test.local', 'JB MANAGER', 'MANAGER'),
  ('00000000-0000-0000-0000-0000000000b2', 'kl@test.local', 'KL MANAGER', 'MANAGER'),
  ('00000000-0000-0000-0000-0000000000b3', 'both@test.local', 'BOTH MANAGER', 'MANAGER');
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000a1';
insert into public.user_outlets (user_id, outlet_id)
select '00000000-0000-0000-0000-0000000000a2'::uuid, id from public.outlets where code in ('JB-FACTORY30', 'JB-BROOOS')
union all select '00000000-0000-0000-0000-0000000000b1'::uuid, id from public.outlets where code = 'JB-FACTORY30'
union all select '00000000-0000-0000-0000-0000000000b2'::uuid, id from public.outlets where code = 'KL-COFFEEMAMAK'
union all select '00000000-0000-0000-0000-0000000000b3'::uuid, id from public.outlets where code in ('JB-FACTORY30', 'KL-COFFEEMAMAK');
set constraints all immediate;

-- Outlet ids readable by everyone below.
create temp table t_outlet as select code, id from public.outlets;
grant select on t_outlet to authenticated;

set local role authenticated;

-- Outlet Admin -------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
do $$
declare
  jb uuid := (select id from t_outlet where code = 'JB-FACTORY30');
  kl uuid := (select id from t_outlet where code = 'KL-COFFEEMAMAK');
begin
  assert not private.is_admin(), 'outlet Admin is not the Super Admin';
  assert private.is_outlet_admin() and private.is_manager(), 'outlet Admin has Manager rights';
  assert private.can_manage_outlet(jb) and not private.can_manage_outlet(kl), 'only own outlets';
  assert (select array_agg(email order by email) from public.profiles) = array['jb@test.local', 'oa@test.local'],
    'sees only users of own outlets';
  assert private.in_admin_scope('00000000-0000-0000-0000-0000000000b1'), 'can approve JB requester';
  assert not private.in_admin_scope('00000000-0000-0000-0000-0000000000b3'), 'not a cross-outlet requester';
  assert not private.in_admin_scope('00000000-0000-0000-0000-0000000000a1'), 'not the Super Admin';

  -- Appoint a JB Manager as Admin of the same outlet.
  perform public.admin_update_user('00000000-0000-0000-0000-0000000000b1', 'ADMIN', 'ACTIVE', array[jb], 1);
  assert (select role from public.profiles where id = '00000000-0000-0000-0000-0000000000b1') = 'ADMIN', 'appointed';

  begin
    perform public.admin_update_user('00000000-0000-0000-0000-0000000000b1', 'MANAGER', 'ACTIVE', array[kl],
      (select revision from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'));
    raise exception 'moving a user to another outlet should fail';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_update_user('00000000-0000-0000-0000-0000000000b2', 'MANAGER', 'SUSPENDED', array[kl], 1);
    raise exception 'editing a KL user should fail';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_update_user('00000000-0000-0000-0000-0000000000a1', 'MANAGER', 'ACTIVE', array[jb], 1);
    raise exception 'editing the Super Admin should fail';
  exception when insufficient_privilege then null;
  end;

  perform public.create_invitation('new.admin@test.local', 'ADMIN', array[jb]);
  begin
    perform public.create_invitation('kl.new@test.local', 'MANAGER', array[kl]);
    raise exception 'inviting to another outlet should fail';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_invitation('global@test.local', 'ADMIN', '{}');
    raise exception 'a global Admin invite should fail';
  exception when check_violation then null;
  end;
  begin
    perform private.require_admin();
    raise exception 'outlet Admin should not pass require_admin (Settings)';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Super Admin ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
begin
  assert private.is_admin(), 'Super Admin is the global Admin';
  assert (select count(*) from public.profiles) = 5, 'sees every user';
  begin
    perform public.admin_update_user(auth.uid(), 'ADMIN', 'SUSPENDED', '{}', 1);
    raise exception 'suspending the Super Admin should fail';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set is_super_admin = false where id = auth.uid();
    raise exception 'removing the flag from the app should fail';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000b2';
    raise exception 'flagging another user from the app should fail';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
do $$
begin
  delete from public.profiles where id = '00000000-0000-0000-0000-0000000000a1';
  raise exception 'deleting the Super Admin should fail';
exception when insufficient_privilege then null;
end;
$$;

rollback;
