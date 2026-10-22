-- Menu publish workflow and Admin user maintenance.
-- Spec: design plan V0.2 ch. 4.3, 6.3, 12.1-12.2; decisions D08, D09, O11, O12.

-- Menus ------------------------------------------------------------------

-- True when every Prep dependency of the recipe's approved version, at any
-- depth, is itself active and approved (ch. 12.2 "依赖有效").
create function private.recipe_dependencies_valid(p_recipe_id uuid) returns boolean
language sql stable set search_path = '' as $$
  with recursive deps (recipe_id) as (
    select ri.prep_recipe_id
      from public.recipes r
      join public.recipe_ingredients ri on ri.recipe_version_id = r.current_approved_version_id
     where r.id = p_recipe_id and ri.prep_recipe_id is not null
    union
    select ri.prep_recipe_id
      from deps d
      join public.recipes r on r.id = d.recipe_id
      join public.recipe_ingredients ri on ri.recipe_version_id = r.current_approved_version_id
     where ri.prep_recipe_id is not null
  )
  select not exists (
    select 1 from deps d join public.recipes r on r.id = d.recipe_id
     where r.current_approved_version_id is null or r.status <> 'ACTIVE'
  );
$$;

-- Live items with names and prices, stored with every publish event (D08).
create function private.menu_items_snapshot(p_menu_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'recipe_id', mi.recipe_id,
           'recipe_version_id', r.current_approved_version_id,
           'product_name', v.product_name,
           'price', mi.price,
           'sort_order', mi.sort_order
         ) order by mi.sort_order), '[]')
    from public.menu_items mi
    join public.recipes r on r.id = mi.recipe_id
    left join public.recipe_versions v on v.id = r.current_approved_version_id
   where mi.menu_id = p_menu_id;
$$;

-- Publish Changes (O12): validates the pending revision, or the current items
-- when there is none (re-publishing an unpublished menu), then swaps them in
-- atomically. No approval (D09). On failure nothing changes and the error
-- detail lists each blocked item as JSON: [{recipe_id, product_name, code}].
create function public.publish_menu(p_menu_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_menu public.menus;
  v_revision_id uuid;
  v_count integer;
  v_problems jsonb;
begin
  select * into v_menu from public.menus where id = p_menu_id for update;
  if v_menu.id is null or not private.can_manage_outlet(v_menu.outlet_id) then
    raise exception 'Menu not found or not permitted' using errcode = '42501';
  end if;
  if v_menu.status = 'ARCHIVED' then
    raise exception 'MENU_ARCHIVED' using errcode = '23514';
  end if;

  select id into v_revision_id from public.menu_revisions where menu_id = p_menu_id;

  create temporary table menu_publish_source on commit drop as
  select ri.recipe_id, ri.price, ri.sort_order
    from public.menu_revision_items ri
   where v_revision_id is not null and ri.menu_revision_id = v_revision_id
  union all
  select mi.recipe_id, mi.price, mi.sort_order
    from public.menu_items mi
   where v_revision_id is null and mi.menu_id = p_menu_id;

  select count(*) into v_count from menu_publish_source;
  if v_count = 0 then
    raise exception 'MENU_EMPTY' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'recipe_id', s.recipe_id,
           'product_name', v.product_name,
           'code', c.code) order by s.sort_order, c.code), '[]')
    into v_problems
    from menu_publish_source s
    join public.recipes r on r.id = s.recipe_id
    left join public.recipe_versions v on v.id = r.current_approved_version_id
   cross join lateral (values
     (case when s.price is null then 'PRICE_MISSING' end),
     (case when r.status <> 'ACTIVE' or v.id is null then 'RECIPE_NOT_APPROVED' end),
     (case when v.purpose <> 'OFFICIAL_RELEASE' then 'NOT_OFFICIAL_RELEASE' end),
     (case when v.id is not null and not private.recipe_dependencies_valid(r.id)
           then 'DEPENDENCY_INVALID' end),
     -- One price per recipe across the outlet's published menus (O11).
     (case when exists (
             select 1 from public.menu_items mi
               join public.menus m on m.id = mi.menu_id
              where m.outlet_id = v_menu.outlet_id
                and m.status = 'PUBLISHED'
                and m.id <> p_menu_id
                and mi.recipe_id = s.recipe_id
                and mi.price <> s.price)
           then 'PRICE_CONFLICT' end)
   ) as c (code)
   where c.code is not null;

  if jsonb_array_length(v_problems) > 0 then
    raise exception 'MENU_PUBLISH_BLOCKED' using errcode = '23514', detail = v_problems::text;
  end if;

  if v_revision_id is not null then
    delete from public.menu_items where menu_id = p_menu_id;
    insert into public.menu_items (menu_id, recipe_id, price, sort_order)
    select p_menu_id, recipe_id, price, sort_order from menu_publish_source;
    delete from public.menu_revisions where id = v_revision_id;
  end if;

  update public.menus
     set status = 'PUBLISHED', published_at = now(), published_by = auth.uid()
   where id = p_menu_id;

  insert into public.menu_publish_history (menu_id, outlet_id, event, snapshot, actor_id)
  values (p_menu_id, v_menu.outlet_id, 'PUBLISH', private.menu_items_snapshot(p_menu_id), auth.uid());
end;
$$;

-- Takes a published menu offline; its items stay so it can be published again.
create function public.unpublish_menu(p_menu_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_menu public.menus;
begin
  select * into v_menu from public.menus where id = p_menu_id for update;
  if v_menu.id is null or not private.can_manage_outlet(v_menu.outlet_id) then
    raise exception 'Menu not found or not permitted' using errcode = '42501';
  end if;
  if v_menu.status <> 'PUBLISHED' then
    raise exception 'Only a published menu can be unpublished' using errcode = '23514';
  end if;

  update public.menus set status = 'UNPUBLISHED' where id = p_menu_id;

  insert into public.menu_publish_history (menu_id, outlet_id, event, snapshot, reason, actor_id)
  values (p_menu_id, v_menu.outlet_id, 'UNPUBLISH', private.menu_items_snapshot(p_menu_id),
          nullif(btrim(p_reason), ''), auth.uid());
end;
$$;

-- Archives a menu (taking it offline if published) and drops pending edits.
create function public.archive_menu(p_menu_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_menu public.menus;
begin
  select * into v_menu from public.menus where id = p_menu_id for update;
  if v_menu.id is null or not private.can_manage_outlet(v_menu.outlet_id) then
    raise exception 'Menu not found or not permitted' using errcode = '42501';
  end if;
  if v_menu.status = 'ARCHIVED' then
    return;
  end if;

  update public.menus set status = 'ARCHIVED' where id = p_menu_id;
  delete from public.menu_revisions where menu_id = p_menu_id;

  insert into public.menu_publish_history (menu_id, outlet_id, event, snapshot, reason, actor_id)
  values (p_menu_id, v_menu.outlet_id, 'ARCHIVE', private.menu_items_snapshot(p_menu_id),
          nullif(btrim(p_reason), ''), auth.uid());
end;
$$;

revoke execute on function public.publish_menu(uuid) from public, anon;
revoke execute on function public.unpublish_menu(uuid, text) from public, anon;
revoke execute on function public.archive_menu(uuid, text) from public, anon;
grant execute on function public.publish_menu(uuid) to authenticated;
grant execute on function public.unpublish_menu(uuid, text) to authenticated;
grant execute on function public.archive_menu(uuid, text) to authenticated;

-- Users ------------------------------------------------------------------

-- Admin changes role, status and outlets in one step so the role/outlet shape
-- (D02) is checked once at commit. p_expected_revision guards concurrent edits.
create function public.admin_update_user(
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
  if not private.is_admin() then
    raise exception 'Only an Admin can change user records' using errcode = '42501';
  end if;
  if p_status not in ('ACTIVE', 'SUSPENDED', 'DEACTIVATED') then
    raise exception 'Status must be ACTIVE, SUSPENDED or DEACTIVATED' using errcode = '23514';
  end if;
  if p_role = 'BARISTA' and cardinality(v_outlets) <> 1 then
    raise exception 'A Barista must belong to exactly one outlet' using errcode = '23514';
  elsif p_role = 'MANAGER' and cardinality(v_outlets) < 1 then
    raise exception 'A Manager must manage at least one outlet' using errcode = '23514';
  elsif p_role = 'ADMIN' and cardinality(v_outlets) > 0 then
    raise exception 'Admin access is global; do not assign outlets' using errcode = '23514';
  end if;
  if (select count(*) from public.outlets where id = any (v_outlets) and is_active)
     <> cardinality(v_outlets) then
    raise exception 'Unknown or inactive outlet' using errcode = '23503';
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
revoke execute on function public.admin_update_user(uuid, public.user_role, public.user_status, uuid[], integer)
  from public, anon;
grant execute on function public.admin_update_user(uuid, public.user_role, public.user_status, uuid[], integer)
  to authenticated;
