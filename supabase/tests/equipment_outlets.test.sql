-- Equipment outlets: Super Admin sets All / outlets in the equipment form; an outlet
-- Admin ticks only their own outlets. Runs in one transaction and rolls back.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'oa@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'manager@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@test.local', 'SUPER ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-0000000000a2', 'oa@test.local', 'OUTLET ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-0000000000b1', 'manager@test.local', 'MANAGER', 'MANAGER');
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000a1';
insert into public.user_outlets (user_id, outlet_id)
select '00000000-0000-0000-0000-0000000000a2'::uuid, id from public.outlets where code = 'JB-BROOOS'
union all select '00000000-0000-0000-0000-0000000000b1'::uuid, id from public.outlets where code = 'JB-BROOOS';

create temp table t_outlet as select code, id from public.outlets;
grant select on t_outlet to authenticated;
grant select on all tables in schema public to authenticated;

set local role authenticated;

-- Super Admin: new grinder for two outlets, then All outlets.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
insert into public.grinders (id, name) values ('00000000-0000-0000-0000-0000000000d1', 'Test EK43');
do $$
declare
  v_mine uuid := (select id from t_outlet where code = 'JB-BROOOS');
  v_other uuid := (select id from t_outlet where code = 'JB-YOUBAR');
  v_third uuid := (select id from t_outlet where code not in ('JB-BROOOS', 'JB-YOUBAR') limit 1);
begin
  perform public.set_equipment_outlets('GRINDER', '00000000-0000-0000-0000-0000000000d1', false, array[v_mine, v_other]);
  assert private.outlet_grinder_ok(v_mine, '00000000-0000-0000-0000-0000000000d1'), 'ticked outlet';
  assert not private.outlet_grinder_ok(v_third, '00000000-0000-0000-0000-0000000000d1'), 'unticked outlet';

  perform public.set_equipment_outlets('GRINDER', '00000000-0000-0000-0000-0000000000d1', true, '{}');
  assert private.outlet_grinder_ok(v_third, '00000000-0000-0000-0000-0000000000d1'), 'All outlets covers every outlet';
  assert (select count(*) from public.outlet_equipment where grinder_id = '00000000-0000-0000-0000-0000000000d1') = 0,
    'All outlets replaces ticked outlets';

  perform public.set_equipment_outlets('GRINDER', '00000000-0000-0000-0000-0000000000d1', false, array[v_other]);
end;
$$;

-- Outlet Admin: ticks own outlet, cannot touch another outlet or All.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
do $$
declare
  v_mine uuid := (select id from t_outlet where code = 'JB-BROOOS');
  v_other uuid := (select id from t_outlet where code = 'JB-YOUBAR');
begin
  perform public.set_equipment_outlets('GRINDER', '00000000-0000-0000-0000-0000000000d1', false, array[v_other, v_mine]);
  assert private.outlet_grinder_ok(v_mine, '00000000-0000-0000-0000-0000000000d1'), 'outlet Admin ticked own outlet';
  begin
    perform public.set_equipment_outlets('GRINDER', '00000000-0000-0000-0000-0000000000d1', false, array[v_mine]);
    raise exception 'outlet Admin should not untick another outlet';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_equipment_outlets('GRINDER', '00000000-0000-0000-0000-0000000000d1', true, '{}');
    raise exception 'outlet Admin should not choose All outlets';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Manager cannot set outlets.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$
declare
  v_mine uuid := (select id from t_outlet where code = 'JB-BROOOS');
  v_other uuid := (select id from t_outlet where code = 'JB-YOUBAR');
begin
  begin
    perform public.set_equipment_outlets('GRINDER', '00000000-0000-0000-0000-0000000000d1', false, array[v_other]);
    raise exception 'manager should not untick an outlet';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
