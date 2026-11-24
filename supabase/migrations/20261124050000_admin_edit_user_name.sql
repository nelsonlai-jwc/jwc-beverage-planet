-- Feedback #15: Admins can correct a user's full name from the Users page.
-- Same people as before may edit (Super Admin: everyone but the Super Admin;
-- outlet Admin: users of their outlets). The name follows the sign-up rules:
-- trimmed, single spaces, upper case, letters and ' / @ - only.

drop function public.admin_update_user(uuid, public.user_role, public.user_status, uuid[], integer);

create function public.admin_update_user(
  p_user_id uuid,
  p_role public.user_role,
  p_status public.user_status,
  p_outlet_ids uuid[],
  p_expected_revision integer,
  p_full_name text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_outlets uuid[] := coalesce(p_outlet_ids, '{}');
  v_name text := upper(btrim(regexp_replace(p_full_name, '\s+', ' ', 'g')));
begin
  if coalesce((select is_super_admin from public.profiles where id = p_user_id), false) then
    raise exception 'SUPER_ADMIN_PROTECTED' using errcode = '42501';
  end if;
  if not private.in_admin_scope(p_user_id) then
    raise exception 'Only an Admin can change user records' using errcode = '42501';
  end if;
  if p_full_name is not null
     and (char_length(v_name) not between 1 and 100 or v_name !~ '^[[:alpha:] ''/@-]+$') then
    raise exception 'NAME_INVALID' using errcode = '23514';
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
     set role = p_role, status = p_status, full_name = coalesce(v_name, full_name)
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

revoke execute on function public.admin_update_user(uuid, public.user_role, public.user_status, uuid[], integer, text) from public, anon;
grant execute on function public.admin_update_user(uuid, public.user_role, public.user_status, uuid[], integer, text) to authenticated;
