-- Deleting leftover (Revoked / Expired) invitation records of an email.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'oa@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'jb@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'super@test.local', 'SUPER ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-0000000000a2', 'oa@test.local', 'OUTLET ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-0000000000b1', 'jb@test.local', 'JB MANAGER', 'MANAGER');
update public.profiles set is_super_admin = true where id = '00000000-0000-0000-0000-0000000000a1';
insert into public.user_outlets (user_id, outlet_id)
select '00000000-0000-0000-0000-0000000000a2'::uuid, id from public.outlets where code = 'JB-FACTORY30'
union all select '00000000-0000-0000-0000-0000000000b1'::uuid, id from public.outlets where code = 'JB-FACTORY30';

create temp table t_outlet as select code, id from public.outlets;
grant select on t_outlet to authenticated;

set local role authenticated;

-- Super Admin sends, then resends (the first becomes Revoked) -------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare
  jb uuid := (select id from t_outlet where code = 'JB-FACTORY30');
  kl uuid := (select id from t_outlet where code = 'KL-COFFEEMAMAK');
begin
  perform public.create_invitation('New.Person@test.local', 'MANAGER', array[jb]);
  perform public.create_invitation('new.person@test.local', 'MANAGER', array[jb]);
  perform public.create_invitation('kl.person@test.local', 'MANAGER', array[kl]);
  perform public.create_invitation('kl.person@test.local', 'MANAGER', array[kl]);
  perform public.create_invitation('jb.expired@test.local', 'BARISTA', array[jb]);
end $$;

-- A Manager cannot delete invitations.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$
begin
  perform public.delete_invitations('new.person@test.local');
  raise exception 'a Manager should not delete invitations';
exception when insufficient_privilege then null;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare
  n integer;
begin
  -- A still-valid Pending invite must be revoked first.
  begin
    perform public.delete_invitations('new.person@test.local');
    raise exception 'deleting with a valid pending invite should fail';
  exception when object_not_in_prerequisite_state then null;
  end;

  perform public.revoke_invitation(
    (select id from public.invitations where email_normalized = 'new.person@test.local' and status = 'PENDING'));
  n := public.delete_invitations(' NEW.person@test.local ');
  assert n = 2, format('expected 2 deleted, got %s', n);
  assert not exists (select 1 from public.invitations where email_normalized = 'new.person@test.local'),
    'all records of the email are gone';
end $$;

-- Accepted invitations are kept; an expired Pending one can be deleted.
reset role;
insert into public.invitations (email, role, token_hash, status, accepted_at)
values ('jb.expired@test.local', 'BARISTA', '\x01', 'ACCEPTED', now());
update public.invitations set expires_at = now() - interval '1 minute'
 where email_normalized = 'jb.expired@test.local' and status = 'PENDING';
set local role authenticated;

-- Outlet Admin: only deletes invitations within their outlets.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
do $$
declare
  n integer;
begin
  n := public.delete_invitations('jb.expired@test.local');
  assert n = 1, format('expected 1 deleted, got %s', n);
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select public.revoke_invitation(
  (select id from public.invitations where email_normalized = 'kl.person@test.local' and status = 'PENDING'));

reset role;
do $$
begin
  assert (select count(*) from public.invitations
           where email_normalized = 'jb.expired@test.local' and status = 'ACCEPTED') = 1,
    'accepted invitation is kept';
  assert (select count(*) from public.invitations where email_normalized = 'kl.person@test.local') = 2,
    'outlet Admin cannot touch other outlets';
end $$;
set local role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
do $$
begin
  assert public.delete_invitations('kl.person@test.local') = 0, 'nothing deleted outside scope';
end $$;

rollback;
