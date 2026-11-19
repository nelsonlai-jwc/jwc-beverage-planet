-- Outlet Equipment: the Super Admin sets up equipment, outlet Admins pick it for their outlets.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

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

insert into public.materials (id, name, brand, material_type_id, created_by, is_coffee_bean)
  select '00000000-0000-0000-0000-0000000000c1', 'Test Bean', 'Test', id,
         '00000000-0000-0000-0000-0000000000b1', true
    from public.material_types where name = 'Other';
update public.materials set status = 'APPROVED' where id = '00000000-0000-0000-0000-0000000000c1';

create temp table t_outlet as select code, id from public.outlets;
grant select on t_outlet to authenticated;
grant select on all tables in schema public to authenticated;

set local role authenticated;

-- Super Admin adds equipment without an outlet; names are unique.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
insert into public.grinders (id, name) values ('00000000-0000-0000-0000-0000000000d1', 'EK43');
insert into public.brewers (id, name) values ('00000000-0000-0000-0000-0000000000d2', 'V60');
do $$
begin
  begin
    insert into public.grinders (name) values ('EK43');
    raise exception 'duplicate grinder name should fail';
  exception when unique_violation then
    null;
  end;
end;
$$;

-- Outlet Admin cannot add equipment, but picks it for their own outlet only.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
do $$
declare
  v_mine uuid := (select id from t_outlet where code = 'JB-BROOOS');
  v_other uuid := (select id from t_outlet where code = 'JB-YOUBAR');
begin
  begin
    insert into public.grinders (name) values ('Mine');
    raise exception 'outlet Admin should not add a grinder';
  exception when insufficient_privilege then
    null;
  end;
  insert into public.outlet_equipment (outlet_id, grinder_id) values (v_mine, '00000000-0000-0000-0000-0000000000d1');
  insert into public.outlet_equipment (outlet_id, brewer_id) values (v_mine, '00000000-0000-0000-0000-0000000000d2');
  begin
    insert into public.outlet_equipment (outlet_id, grinder_id) values (v_other, '00000000-0000-0000-0000-0000000000d1');
    raise exception 'outlet Admin should not set another outlet';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.outlet_equipment (outlet_id, grinder_id) values (v_mine, '00000000-0000-0000-0000-0000000000d1');
    raise exception 'same equipment twice should fail';
  exception when unique_violation then
    null;
  end;
end;
$$;

-- Manager cannot change an outlet's equipment.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$
declare
  v_mine uuid := (select id from t_outlet where code = 'JB-BROOOS');
  v_count integer;
begin
  begin
    insert into public.outlet_equipment (outlet_id, grinder_id) values (v_mine, '00000000-0000-0000-0000-0000000000d1');
    raise exception 'manager should not set outlet equipment';
  exception when insufficient_privilege or unique_violation then
    null;
  end;
  delete from public.outlet_equipment where outlet_id = v_mine;
  get diagnostics v_count = row_count;
  assert v_count = 0, 'manager should not remove outlet equipment';

  -- The outlet's equipment can be used for a daily record.
  insert into public.filter_calibrations (outlet_id, coffee_bean_material_id, brewer_id, grinder_id, grind_setting,
                                          dose_g, water_g, total_time_seconds)
  values (v_mine, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d2',
          '00000000-0000-0000-0000-0000000000d1', '10', 15, 250, 180);
end;
$$;

-- Super Admin sets another outlet; a removed grinder can no longer be chosen there.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare
  v_other uuid := (select id from t_outlet where code = 'JB-YOUBAR');
  v_mine uuid := (select id from t_outlet where code = 'JB-BROOOS');
begin
  insert into public.outlet_equipment (outlet_id, grinder_id) values (v_other, '00000000-0000-0000-0000-0000000000d1');
  delete from public.outlet_equipment where outlet_id = v_mine and grinder_id is not null;
  assert not private.outlet_grinder_ok(v_mine, '00000000-0000-0000-0000-0000000000d1'), 'removed grinder not usable';
  assert private.outlet_grinder_ok(v_other, '00000000-0000-0000-0000-0000000000d1'), 'grinder shared by outlets';
end;
$$;

rollback;
