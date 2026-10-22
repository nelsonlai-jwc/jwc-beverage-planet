-- Read-only helpers for the three reports (ch. 15). No table changes.

-- Current cost estimate of every active approved recipe the caller manages
-- (Admin: all outlets; Manager: own outlets), in one call instead of one
-- calculate_recipe_cost call per drink. Same calculation and reason codes.
create function public.report_current_costs(p_outlet_id uuid default null)
returns table (recipe_id uuid, outlet_id uuid, version_id uuid, cost jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
begin
  if private.current_user_role() not in ('ADMIN', 'MANAGER') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  for r in
    select rc.id, rc.outlet_id, rc.current_approved_version_id
      from public.recipes rc
     where rc.status = 'ACTIVE'
       and rc.current_approved_version_id is not null
       and (p_outlet_id is null or rc.outlet_id = p_outlet_id)
       and private.can_manage_outlet(rc.outlet_id)
  loop
    recipe_id := r.id;
    outlet_id := r.outlet_id;
    version_id := r.current_approved_version_id;
    cost := private.recipe_cost_tree(r.current_approved_version_id, array[r.id]);
    return next;
  end loop;
end;
$$;

-- Names of the people behind recipe versions the caller manages, for the R&D
-- report's person filter. Profiles are otherwise visible to Admins only.
create function public.report_version_people()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select distinct p.id, p.full_name
    from public.recipe_versions v
    join public.recipes r on r.id = v.recipe_id
    join public.profiles p on p.id in (v.created_by, v.submitted_by, v.approved_by)
   where private.current_user_role() in ('ADMIN', 'MANAGER')
     and private.can_manage_outlet(r.outlet_id);
$$;

revoke execute on function public.report_current_costs(uuid) from public, anon;
revoke execute on function public.report_version_people() from public, anon;
grant execute on function public.report_current_costs(uuid) to authenticated;
grant execute on function public.report_version_people() to authenticated;
