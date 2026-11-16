-- Super Admin and outlet Admins.
-- One Super Admin (a flag on Nelson's profile) has global Admin power; nobody can
-- demote, suspend, deactivate or delete that account, and the flag cannot be changed
-- from the app. Every other Admin is bound to one or more outlets: for their outlets
-- they work like a Manager, and in addition they manage users, approve recipes and
-- approve raw material / price requests submitted by people of their outlets.
-- Settings and other global Admin actions stay with the Super Admin.

alter table public.profiles add column is_super_admin boolean not null default false;
alter table public.profiles add constraint profiles_super_admin_is_admin
  check (not is_super_admin or role = 'ADMIN');
create unique index profiles_one_super_admin on public.profiles (is_super_admin) where is_super_admin;

update public.profiles set is_super_admin = true
 where email_normalized = 'nelson.lai@justwantcoffee.com';

-- Role helpers ------------------------------------------------------------------
-- is_admin() now means the Super Admin (global power); every existing check keeps
-- working and becomes Super Admin only.
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.is_super_admin from public.profiles p
     where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'ADMIN'
  ), false);
$$;

create or replace function private.is_outlet_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_user_role() = 'ADMIN', false) and not private.is_admin();
$$;
grant execute on function private.is_outlet_admin() to authenticated;

-- An outlet Admin has every Manager right for their outlets.
create or replace function private.is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_user_role() = 'MANAGER', false) or private.is_outlet_admin();
$$;

-- True when p_ids is non-empty and every outlet in it is one of the caller's outlets.
create function private.outlets_within_mine(p_ids uuid[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select cardinality(coalesce(p_ids, '{}')) > 0
     and not exists (
       select 1 from unnest(p_ids) as o(id)
        where not exists (
          select 1 from public.user_outlets m
           where m.user_id = auth.uid() and m.outlet_id = o.id));
$$;
grant execute on function private.outlets_within_mine(uuid[]) to authenticated;

-- The caller may manage this user, or approve this user's requests: Super Admin
-- always; an outlet Admin when every outlet of the user is one of theirs (so never
-- the Super Admin, who has no outlets).
create function private.in_admin_scope(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or (
    private.is_outlet_admin()
    and p_user_id is not null
    and not coalesce((select is_super_admin from public.profiles where id = p_user_id), false)
    and private.outlets_within_mine(
          array(select outlet_id from public.user_outlets where user_id = p_user_id))
  );
$$;
grant execute on function private.in_admin_scope(uuid) to authenticated;

create function private.require_request_approver(p_requester uuid) returns void
language plpgsql stable set search_path = '' as $$
begin
  if not private.in_admin_scope(p_requester) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
end;
$$;
grant execute on function private.require_request_approver(uuid) to authenticated;

-- Super Admin, or an outlet Admin of every outlet of the recipe (never All outlets).
create function private.can_approve_recipe(p_recipe_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or (private.is_outlet_admin() and private.can_manage_recipe(p_recipe_id));
$$;
grant execute on function private.can_approve_recipe(uuid) to authenticated;

create function private.invitation_in_scope(p_invitation_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or (
    private.is_outlet_admin()
    and private.outlets_within_mine(
          array(select outlet_id from public.invitation_outlets where invitation_id = p_invitation_id))
  );
$$;
grant execute on function private.invitation_in_scope(uuid) to authenticated;

-- Requesters whose raw material / price requests the caller can approve (for the UI).
create function public.approvable_requester_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where private.in_admin_scope(p.id);
$$;
revoke execute on function public.approvable_requester_ids() from public, anon;
grant execute on function public.approvable_requester_ids() to authenticated;

-- Role / outlet shape (D02): Barista exactly one outlet, Manager at least one,
-- Super Admin none (global), every other Admin at least one.
create or replace function private.check_user_outlets(p_user_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_role public.user_role;
  v_super boolean;
  v_count integer;
begin
  select role, is_super_admin into v_role, v_super from public.profiles where id = p_user_id;
  if v_role is null then
    return;
  end if;
  select count(*) into v_count from public.user_outlets where user_id = p_user_id;
  if v_role = 'BARISTA' and v_count <> 1 then
    raise exception 'A Barista must belong to exactly one outlet' using errcode = '23514';
  elsif v_role = 'MANAGER' and v_count < 1 then
    raise exception 'A Manager must manage at least one outlet' using errcode = '23514';
  elsif v_role = 'ADMIN' and v_super and v_count > 0 then
    raise exception 'The Super Admin is global; do not assign outlets' using errcode = '23514';
  elsif v_role = 'ADMIN' and not v_super and v_count < 1 then
    raise exception 'An Admin must manage at least one outlet' using errcode = '23514';
  end if;
end;
$$;

-- Profile guards: Super Admin cannot be changed or removed; the flag is set only
-- outside the app (SQL editor).
create or replace function private.profiles_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.is_api_caller() and not private.is_admin() then
    raise exception 'Only an Admin can change user records' using errcode = '42501';
  end if;
  if new.id <> old.id or new.email <> old.email then
    raise exception 'User id and email cannot be changed' using errcode = '23514';
  end if;
  if new.is_super_admin is distinct from old.is_super_admin and private.is_api_caller() then
    raise exception 'SUPER_ADMIN_PROTECTED' using errcode = '42501';
  end if;
  if old.is_super_admin and new.is_super_admin
     and (new.role <> old.role or new.status <> old.status) then
    raise exception 'SUPER_ADMIN_PROTECTED' using errcode = '42501';
  end if;
  if new.status in ('SUSPENDED', 'DEACTIVATED') and old.status = 'ACTIVE' then
    new.deactivated_at := now();
  elsif new.status = 'ACTIVE' and old.status <> 'ACTIVE' then
    new.deactivated_at := null;
  end if;
  if old.role = 'ADMIN' and old.status = 'ACTIVE'
     and (new.role <> 'ADMIN' or new.status <> 'ACTIVE')
     and not exists (
       select 1 from public.profiles p
       where p.role = 'ADMIN' and p.status = 'ACTIVE' and p.id <> old.id
     ) then
    raise exception 'Cannot remove the last active Admin' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function private.profiles_delete_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.is_super_admin then
    raise exception 'SUPER_ADMIN_PROTECTED' using errcode = '42501';
  end if;
  return old;
end;
$$;
create trigger profiles_delete_guard before delete on public.profiles
  for each row execute function private.profiles_delete_guard();

-- Users: invite, revoke, edit ------------------------------------------------------
create or replace function public.create_invitation(p_email text, p_role public.user_role, p_outlet_ids uuid[])
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_outlets uuid[] := coalesce(p_outlet_ids, '{}');
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_id uuid;
  v_expires timestamptz;
begin
  if not (private.is_admin() or private.is_outlet_admin()) then
    raise exception 'Only an Admin can invite users' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where email_normalized = v_email) then
    raise exception 'This email already has an account; edit the user instead'
      using errcode = '23505';
  end if;
  if p_role = 'BARISTA' and cardinality(v_outlets) <> 1 then
    raise exception 'A Barista must belong to exactly one outlet' using errcode = '23514';
  elsif p_role in ('MANAGER', 'ADMIN') and cardinality(v_outlets) < 1 then
    raise exception 'A Manager or Admin must have at least one outlet' using errcode = '23514';
  end if;
  if (select count(*) from public.outlets where id = any (v_outlets) and is_active)
     <> cardinality(v_outlets) then
    raise exception 'Unknown or inactive outlet' using errcode = '23503';
  end if;
  if not private.is_admin() then
    if not private.outlets_within_mine(v_outlets) then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
    -- Re-sending replaces the previous link, so it must be one this Admin may manage.
    if exists (select 1 from public.invitations i
                where i.email_normalized = v_email and i.status = 'PENDING'
                  and not private.invitation_in_scope(i.id)) then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  end if;

  update public.invitations
     set status = 'REVOKED', revoked_at = now()
   where email_normalized = v_email and status = 'PENDING';

  insert into public.invitations (email, role, token_hash, invited_by)
  values (v_email, p_role, private.hash_token(v_token), auth.uid())
  returning id, invitations.expires_at into v_id, v_expires;

  insert into public.invitation_outlets (invitation_id, outlet_id)
  select v_id, unnest(v_outlets);

  return query select v_id, v_token, v_expires;
end;
$$;

create or replace function public.revoke_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.invitation_in_scope(p_invitation_id) then
    raise exception 'Only an Admin can revoke invitations' using errcode = '42501';
  end if;
  update public.invitations
     set status = 'REVOKED', revoked_at = now()
   where id = p_invitation_id and status = 'PENDING';
end;
$$;

create or replace function public.admin_update_user(
  p_user_id uuid,
  p_role public.user_role,
  p_status public.user_status,
  p_outlet_ids uuid[],
  p_expected_revision integer
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_outlets uuid[] := coalesce(p_outlet_ids, '{}');
begin
  if coalesce((select is_super_admin from public.profiles where id = p_user_id), false) then
    raise exception 'SUPER_ADMIN_PROTECTED' using errcode = '42501';
  end if;
  if not private.in_admin_scope(p_user_id) then
    raise exception 'Only an Admin can change user records' using errcode = '42501';
  end if;
  if p_status not in ('ACTIVE', 'SUSPENDED', 'DEACTIVATED') then
    raise exception 'Status must be ACTIVE, SUSPENDED or DEACTIVATED' using errcode = '23514';
  end if;
  if p_role = 'BARISTA' and cardinality(v_outlets) <> 1 then
    raise exception 'A Barista must belong to exactly one outlet' using errcode = '23514';
  elsif p_role in ('MANAGER', 'ADMIN') and cardinality(v_outlets) < 1 then
    raise exception 'A Manager or Admin must have at least one outlet' using errcode = '23514';
  end if;
  if (select count(*) from public.outlets where id = any (v_outlets) and is_active)
     <> cardinality(v_outlets) then
    raise exception 'Unknown or inactive outlet' using errcode = '23503';
  end if;
  if not private.is_admin() and not private.outlets_within_mine(v_outlets) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  update public.profiles
     set role = p_role, status = p_status
   where id = p_user_id and revision = p_expected_revision;
  if not found then
    raise exception 'REVISION_CONFLICT' using errcode = '40001';
  end if;

  delete from public.user_outlets
   where user_id = p_user_id and not (outlet_id = any (v_outlets));
  insert into public.user_outlets (user_id, outlet_id)
  select p_user_id, o from unnest(v_outlets) as o
  on conflict do nothing;
end;
$$;

-- Read access for outlet Admins: users and invitations of their outlets.
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.in_admin_scope(id));

drop policy user_outlets_select on public.user_outlets;
create policy user_outlets_select on public.user_outlets for select to authenticated
  using (user_id = auth.uid() or private.in_admin_scope(user_id));

drop policy invitations_select on public.invitations;
create policy invitations_select on public.invitations for select to authenticated
  using (private.invitation_in_scope(id));

drop policy invitation_outlets_select on public.invitation_outlets;
create policy invitation_outlets_select on public.invitation_outlets for select to authenticated
  using (private.invitation_in_scope(invitation_id));

-- Approvals --------------------------------------------------------------------------
create or replace function public.approve_material(p_material_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status public.approval_status;
  v_price_id uuid;
begin
  perform private.require_request_approver((select created_by from public.materials where id = p_material_id));
  select status into v_status from public.materials where id = p_material_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;

  update public.material_packs
     set status = 'APPROVED', approved_by = auth.uid(), approved_at = now()
   where material_id = p_material_id and status = 'PENDING';
  for v_price_id in
    select pv.id from public.material_price_versions pv
      join public.material_packs p on p.id = pv.pack_id
     where p.material_id = p_material_id and pv.status = 'PENDING'
  loop
    perform private.approve_material_price_row(v_price_id);
  end loop;
  update public.materials
     set status = 'APPROVED', approved_by = auth.uid(), approved_at = now()
   where id = p_material_id;
  perform private.log_approval('MATERIAL', p_material_id, 'APPROVE');
end;
$function$;

create or replace function public.return_material(p_material_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status public.approval_status;
begin
  perform private.require_request_approver((select created_by from public.materials where id = p_material_id));
  perform private.require_reason(p_reason);
  select status into v_status from public.materials where id = p_material_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;

  update public.material_packs set status = 'RETURNED'
   where material_id = p_material_id and status = 'PENDING';
  update public.material_price_versions pv set status = 'RETURNED'
    from public.material_packs p
   where p.id = pv.pack_id and p.material_id = p_material_id and pv.status = 'PENDING';
  update public.materials set status = 'RETURNED' where id = p_material_id;
  perform private.log_approval('MATERIAL', p_material_id, 'RETURN', p_reason);
end;
$function$;

create or replace function public.approve_material_pack(p_pack_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status public.approval_status;
  v_price_id uuid;
begin
  perform private.require_request_approver((select created_by from public.material_packs where id = p_pack_id));
  select status into v_status from public.material_packs where id = p_pack_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;

  update public.material_packs
     set status = 'APPROVED', approved_by = auth.uid(), approved_at = now()
   where id = p_pack_id;
  for v_price_id in
    select id from public.material_price_versions where pack_id = p_pack_id and status = 'PENDING'
  loop
    perform private.approve_material_price_row(v_price_id);
  end loop;
  perform private.log_approval('MATERIAL_PACK', p_pack_id, 'APPROVE');
end;
$function$;

create or replace function public.return_material_pack(p_pack_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status public.approval_status;
begin
  perform private.require_request_approver((select created_by from public.material_packs where id = p_pack_id));
  perform private.require_reason(p_reason);
  select status into v_status from public.material_packs where id = p_pack_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;

  update public.material_price_versions set status = 'RETURNED'
   where pack_id = p_pack_id and status = 'PENDING';
  update public.material_packs set status = 'RETURNED' where id = p_pack_id;
  perform private.log_approval('MATERIAL_PACK', p_pack_id, 'RETURN', p_reason);
end;
$function$;

create or replace function public.approve_material_price(p_price_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status public.approval_status;
begin
  perform private.require_request_approver((select created_by from public.material_price_versions where id = p_price_id));
  select status into v_status from public.material_price_versions where id = p_price_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;
  perform private.approve_material_price_row(p_price_id);
  perform private.log_approval('MATERIAL_PRICE', p_price_id, 'APPROVE');
end;
$function$;

create or replace function public.return_material_price(p_price_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status public.approval_status;
begin
  perform private.require_request_approver((select created_by from public.material_price_versions where id = p_price_id));
  perform private.require_reason(p_reason);
  select status into v_status from public.material_price_versions where id = p_price_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;
  update public.material_price_versions set status = 'RETURNED' where id = p_price_id;
  perform private.log_approval('MATERIAL_PRICE', p_price_id, 'RETURN', p_reason);
end;
$function$;

create or replace function public.approve_packaging_item(p_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status public.approval_status;
  v_price_id uuid;
begin
  perform private.require_request_approver((select created_by from public.packaging_items where id = p_item_id));
  select status into v_status from public.packaging_items where id = p_item_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;

  for v_price_id in
    select id from public.packaging_prices where packaging_item_id = p_item_id and status = 'PENDING'
  loop
    perform private.approve_packaging_price_row(v_price_id);
  end loop;
  update public.packaging_items
     set status = 'APPROVED', approved_by = auth.uid(), approved_at = now()
   where id = p_item_id;
  perform private.log_approval('PACKAGING_ITEM', p_item_id, 'APPROVE');
end;
$function$;

create or replace function public.return_packaging_item(p_item_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status public.approval_status;
begin
  perform private.require_request_approver((select created_by from public.packaging_items where id = p_item_id));
  perform private.require_reason(p_reason);
  select status into v_status from public.packaging_items where id = p_item_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;

  update public.packaging_prices set status = 'RETURNED'
   where packaging_item_id = p_item_id and status = 'PENDING';
  update public.packaging_items set status = 'RETURNED' where id = p_item_id;
  perform private.log_approval('PACKAGING_ITEM', p_item_id, 'RETURN', p_reason);
end;
$function$;

create or replace function public.approve_packaging_price(p_price_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status public.approval_status;
begin
  perform private.require_request_approver((select created_by from public.packaging_prices where id = p_price_id));
  select status into v_status from public.packaging_prices where id = p_price_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;
  perform private.approve_packaging_price_row(p_price_id);
  perform private.log_approval('PACKAGING_PRICE', p_price_id, 'APPROVE');
end;
$function$;

create or replace function public.return_packaging_price(p_price_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status public.approval_status;
begin
  perform private.require_request_approver((select created_by from public.packaging_prices where id = p_price_id));
  perform private.require_reason(p_reason);
  select status into v_status from public.packaging_prices where id = p_price_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;
  update public.packaging_prices set status = 'RETURNED' where id = p_price_id;
  perform private.log_approval('PACKAGING_PRICE', p_price_id, 'RETURN', p_reason);
end;
$function$;

create or replace function public.review_change_request(p_request_id uuid, p_approve boolean, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request public.change_requests;
begin
  select * into v_request from public.change_requests where id = p_request_id for update;
  if not found or v_request.status <> 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;
  if v_request.entity_type = 'RECIPE' then
    if not private.can_approve_recipe(v_request.entity_id) then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  else
    perform private.require_request_approver(v_request.requested_by);
  end if;
  if p_approve then
    perform private.apply_change(v_request.entity_type, v_request.entity_id, v_request.action, v_request.changes);
    update public.change_requests
       set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now(),
           review_reason = nullif(btrim(coalesce(p_reason, '')), '')
     where id = p_request_id;
  else
    perform private.require_reason(p_reason);
    update public.change_requests
       set status = 'RETURNED', reviewed_by = auth.uid(), reviewed_at = now(), review_reason = btrim(p_reason)
     where id = p_request_id;
  end if;
end;
$function$;

create or replace function public.undo_approval(p_entity_type text, p_entity_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.recipe_versions;
  r public.recipes;
  v_prev uuid;
  v_blocker text;
  v_pack uuid;
  v_status public.approval_status;
begin
  perform private.require_reason(p_reason);
  if p_entity_type = 'RECIPE_VERSION' then
    if not private.can_approve_recipe((select recipe_id from public.recipe_versions where id = p_entity_id)) then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  elsif p_entity_type = 'MATERIAL_PRICE' then
    perform private.require_request_approver((select created_by from public.material_price_versions where id = p_entity_id));
  elsif p_entity_type = 'PACKAGING_PRICE' then
    perform private.require_request_approver((select created_by from public.packaging_prices where id = p_entity_id));
  elsif p_entity_type = 'MATERIAL' then
    perform private.require_request_approver((select created_by from public.materials where id = p_entity_id));
  else
    perform private.require_admin();
  end if;

  if p_entity_type = 'RECIPE_VERSION' then
    select * into v from public.recipe_versions where id = p_entity_id;
    if not found then
      raise exception 'NOT_FOUND' using errcode = '22023';
    end if;
    select * into r from public.recipes where id = v.recipe_id for update;
    select * into v from public.recipe_versions where id = p_entity_id for update;
    if v.status <> 'APPROVED' or r.current_approved_version_id is distinct from v.id then
      raise exception 'NOT_CURRENT_APPROVAL' using errcode = '22023';
    end if;
    if r.status <> 'ACTIVE' then
      raise exception 'RECIPE_ARCHIVED' using errcode = '22023';
    end if;
    if exists (select 1 from public.recipe_versions
                where recipe_id = r.id and status in ('DRAFT', 'PENDING', 'RETURNED')) then
      raise exception 'OPEN_VERSION_EXISTS' using errcode = '22023';
    end if;
    select id into v_prev from public.recipe_versions
     where recipe_id = r.id and status = 'SUPERSEDED'
     order by approved_at desc nulls last, version_no desc
     limit 1;
    if v_prev is null then
      v_blocker := private.recipe_archive_blocker(r.id);
      if v_blocker in ('ON_MENU', 'IN_USE') then
        raise exception '%', v_blocker using errcode = '22023';
      end if;
    end if;

    update public.recipe_versions
       set status = 'PENDING', approved_by = null, approved_at = null, updated_by = auth.uid()
     where id = v.id;
    if v_prev is not null then
      update public.recipe_versions set status = 'APPROVED' where id = v_prev;
    end if;
    update public.recipes set current_approved_version_id = v_prev where id = r.id;

    insert into public.approval_events (entity_type, entity_id, outlet_id, action, reason, actor_id)
    values ('RECIPE_VERSION', v.id, r.outlet_id, 'ROLLBACK', btrim(p_reason), auth.uid());

    insert into public.menu_publish_history (menu_id, outlet_id, event, snapshot, actor_id)
    select m.id, m.outlet_id, 'RECIPE_VERSION_UPDATE',
           jsonb_build_object('recipe_id', r.id, 'from_version_id', v.id, 'to_version_id', v_prev),
           auth.uid()
      from public.menus m
     where m.status = 'PUBLISHED'
       and exists (select 1 from public.menu_items mi where mi.menu_id = m.id and mi.recipe_id = r.id);

  elsif p_entity_type = 'MATERIAL_PRICE' then
    select status, pack_id into v_status, v_pack
      from public.material_price_versions where id = p_entity_id for update;
    if v_status is distinct from 'APPROVED' then
      raise exception 'NOT_CURRENT_APPROVAL' using errcode = '22023';
    end if;
    if exists (select 1 from public.material_price_versions
                where pack_id = v_pack and status in ('DRAFT', 'PENDING', 'RETURNED')) then
      raise exception 'OPEN_PRICE_EXISTS' using errcode = '22023';
    end if;
    select id into v_prev from public.material_price_versions
     where pack_id = v_pack and status = 'SUPERSEDED'
     order by effective_from desc, created_at desc
     limit 1;
    if v_prev is null then
      raise exception 'NO_PREVIOUS_PRICE' using errcode = '22023';
    end if;
    update public.material_price_versions
       set status = 'PENDING', approved_by = null, approved_at = null, effective_from = null
     where id = p_entity_id;
    update public.material_price_versions set status = 'APPROVED' where id = v_prev;
    perform private.log_approval('MATERIAL_PRICE', p_entity_id, 'ROLLBACK', p_reason);

  elsif p_entity_type = 'PACKAGING_PRICE' then
    select status, packaging_item_id into v_status, v_pack
      from public.packaging_prices where id = p_entity_id for update;
    if v_status is distinct from 'APPROVED' then
      raise exception 'NOT_CURRENT_APPROVAL' using errcode = '22023';
    end if;
    if exists (select 1 from public.packaging_prices
                where packaging_item_id = v_pack and status in ('DRAFT', 'PENDING', 'RETURNED')) then
      raise exception 'OPEN_PRICE_EXISTS' using errcode = '22023';
    end if;
    select id into v_prev from public.packaging_prices
     where packaging_item_id = v_pack and status = 'SUPERSEDED'
     order by effective_from desc, created_at desc
     limit 1;
    if v_prev is null then
      raise exception 'NO_PREVIOUS_PRICE' using errcode = '22023';
    end if;
    update public.packaging_prices
       set status = 'PENDING', approved_by = null, approved_at = null, effective_from = null
     where id = p_entity_id;
    update public.packaging_prices set status = 'APPROVED' where id = v_prev;
    perform private.log_approval('PACKAGING_PRICE', p_entity_id, 'ROLLBACK', p_reason);

  elsif p_entity_type = 'MATERIAL' then
    select status into v_status from public.materials where id = p_entity_id for update;
    if v_status is distinct from 'APPROVED' then
      raise exception 'NOT_CURRENT_APPROVAL' using errcode = '22023';
    end if;
    if private.recipes_using(p_entity_id, null) > 0 then
      raise exception 'IN_USE' using errcode = '22023';
    end if;
    if exists (select 1 from public.material_price_versions pv
                 join public.material_packs p on p.id = pv.pack_id
                where p.material_id = p_entity_id and pv.status = 'SUPERSEDED') then
      raise exception 'LATER_CHANGES' using errcode = '22023';
    end if;
    if exists (select 1 from public.change_requests
                where entity_type = 'MATERIAL' and entity_id = p_entity_id and status = 'PENDING') then
      raise exception 'REQUEST_ALREADY_PENDING' using errcode = '22023';
    end if;
    update public.material_price_versions pv
       set status = 'PENDING', approved_by = null, approved_at = null, effective_from = null
      from public.material_packs p
     where p.id = pv.pack_id and p.material_id = p_entity_id and pv.status = 'APPROVED';
    update public.material_packs
       set status = 'PENDING', approved_by = null, approved_at = null
     where material_id = p_entity_id and status = 'APPROVED';
    update public.materials
       set status = 'PENDING', approved_by = null, approved_at = null, updated_by = auth.uid()
     where id = p_entity_id;
    perform private.log_approval('MATERIAL', p_entity_id, 'ROLLBACK', p_reason);

  else
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
end;
$function$;

create or replace function public.approve_recipe_version(p_version_id uuid, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.recipe_versions;
  r public.recipes;
  v_errors jsonb;
  v_cost jsonb;
  v_snapshot uuid;
begin
  if not private.can_approve_recipe((select recipe_id from public.recipe_versions where id = p_version_id)) then
    raise exception 'Only an Admin can approve a recipe' using errcode = '42501';
  end if;
  if p_idempotency_key is not null and exists (
    select 1 from public.approval_events where idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('status', 'APPROVED', 'version_id', p_version_id, 'repeated', true);
  end if;

  select * into v from public.recipe_versions where id = p_version_id;
  select * into r from public.recipes where id = v.recipe_id for update;
  select * into v from public.recipe_versions where id = p_version_id for update;
  if v.id is null or v.status <> 'PENDING' then
    raise exception 'Only a pending version can be approved' using errcode = '23514';
  end if;

  v_errors := private.validate_recipe_version(p_version_id);
  -- Dependencies are approved first, then the drink (O07).
  select v_errors || coalesce(jsonb_agg(jsonb_build_object(
           'code', 'PREP_NOT_APPROVED', 'field', 'ingredients', 'line', ri.sort_order)), '[]')
    into v_errors
    from public.recipe_ingredients ri
    join public.recipes p on p.id = ri.prep_recipe_id
   where ri.recipe_version_id = p_version_id and p.current_approved_version_id is null;
  if jsonb_array_length(v_errors) > 0 then
    raise exception 'RECIPE_INVALID' using errcode = '23514', detail = v_errors::text;
  end if;

  if to_regprocedure('public.calculate_recipe_cost(uuid)') is null then
    raise exception 'COST_UNAVAILABLE' using errcode = '23514',
      detail = 'Cost calculation is not installed yet, so approval is blocked (O09)';
  end if;
  execute 'select public.calculate_recipe_cost($1)' into v_cost using p_version_id;
  if not coalesce((v_cost ->> 'is_complete')::boolean, false) then
    raise exception 'COST_INCOMPLETE' using errcode = '23514',
      detail = coalesce(v_cost -> 'incomplete_reasons', '[]')::text;
  end if;

  if r.current_approved_version_id is not null then
    update public.recipe_versions set status = 'SUPERSEDED' where id = r.current_approved_version_id;
  end if;
  update public.recipe_versions
     set status = 'APPROVED', approved_by = auth.uid(), approved_at = now(), updated_by = auth.uid()
   where id = p_version_id;
  update public.recipes set current_approved_version_id = p_version_id where id = r.id;

  insert into public.cost_snapshots (recipe_version_id, outlet_id, reason, total_cost, is_complete, calculated_by)
  values (p_version_id, r.outlet_id, 'RECIPE_APPROVAL', (v_cost ->> 'total_cost')::numeric, true, auth.uid())
  returning id into v_snapshot;
  perform private.insert_cost_lines(v_snapshot, null, v_cost -> 'lines');

  insert into public.approval_events (entity_type, entity_id, outlet_id, action, actor_id, idempotency_key)
  values ('RECIPE_VERSION', p_version_id, r.outlet_id, 'APPROVE', auth.uid(), p_idempotency_key);

  insert into public.menu_publish_history (menu_id, outlet_id, event, snapshot, actor_id)
  select m.id, m.outlet_id, 'RECIPE_VERSION_UPDATE',
         jsonb_build_object('recipe_id', r.id,
                            'from_version_id', r.current_approved_version_id,
                            'to_version_id', p_version_id),
         auth.uid()
    from public.menus m
   where m.status = 'PUBLISHED'
     and exists (select 1 from public.menu_items mi where mi.menu_id = m.id and mi.recipe_id = r.id);

  return jsonb_build_object('status', 'APPROVED', 'version_id', p_version_id, 'snapshot_id', v_snapshot);
end;
$function$;

create or replace function public.return_recipe_version(p_version_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.recipe_versions;
  v_outlet uuid;
begin
  if not private.can_approve_recipe((select recipe_id from public.recipe_versions where id = p_version_id)) then
    raise exception 'Only an Admin can return a recipe' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required to return a recipe' using errcode = '23514';
  end if;
  select * into v from public.recipe_versions where id = p_version_id for update;
  if v.id is null or v.status <> 'PENDING' then
    raise exception 'Only a pending version can be returned' using errcode = '23514';
  end if;
  select outlet_id into v_outlet from public.recipes where id = v.recipe_id;

  update public.recipe_versions set status = 'RETURNED', updated_by = auth.uid() where id = p_version_id;
  insert into public.approval_events (entity_type, entity_id, outlet_id, action, reason, actor_id)
  values ('RECIPE_VERSION', p_version_id, v_outlet, 'RETURN', btrim(p_reason), auth.uid());
end;
$function$;
