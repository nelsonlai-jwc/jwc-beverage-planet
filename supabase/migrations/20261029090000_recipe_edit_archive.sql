-- Editing, archiving and restoring recipes, and a readable change log.
-- Decided with Nelson 2026-10-28:
--   * A Manager edits and deletes every recipe of their own outlet (can_manage_outlet).
--   * An Admin's edit of an approved recipe takes effect on save: the new version is
--     submitted and approved in one step, with the same checks as a normal approval (O09).
--   * "Delete": a recipe that was never submitted is really deleted (recipes_delete_draft);
--     anything else is archived (D19). Archiving a recipe with an approved version is
--     direct for an Admin and a request for a Manager. A recipe on a published menu, or
--     used as Prep by a live recipe, cannot be archived.
--   * An Admin can restore an archived recipe.

-- An archived recipe gets no new versions and nothing is submitted or approved ---------

create or replace function private.recipe_versions_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_is_prep boolean;
  v_status public.record_status;
begin
  if tg_op = 'UPDATE' then
    if new.recipe_id <> old.recipe_id or new.version_no <> old.version_no then
      raise exception 'Version identity cannot change' using errcode = '23514';
    end if;
    if private.is_api_caller() and old.status not in ('DRAFT', 'RETURNED') then
      raise exception 'Submitted versions are read-only; withdraw or create a new version'
        using errcode = '42501';
    end if;
  end if;
  select is_prep, status into v_is_prep, v_status from public.recipes where id = new.recipe_id;
  if v_status = 'ARCHIVED' then
    if tg_op = 'INSERT' or private.is_api_caller() then
      raise exception 'RECIPE_ARCHIVED' using errcode = '22023';
    elsif new.status is distinct from old.status and new.status in ('PENDING', 'APPROVED') then
      raise exception 'RECIPE_ARCHIVED' using errcode = '22023';
    end if;
  end if;
  if new.style is not null and (new.style = 'PREP_MATERIAL') <> v_is_prep then
    raise exception 'Style PREP_MATERIAL must match the recipe type' using errcode = '23514';
  end if;
  if not v_is_prep and new.yield_quantity is not null then
    raise exception 'Only Prep Material recipes record a yield' using errcode = '23514';
  end if;
  if private.is_api_caller() then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

-- Archive, restore and change requests for recipes -----------------------------------

create or replace function private.entity_row(p_entity_type text, p_entity_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case p_entity_type
    when 'MATERIAL' then (select to_jsonb(m) from public.materials m where m.id = p_entity_id)
    when 'PACKAGING_ITEM' then (select to_jsonb(p) from public.packaging_items p where p.id = p_entity_id)
    when 'RECIPE' then (select to_jsonb(r) from public.recipes r where r.id = p_entity_id)
  end;
$$;

-- Why a recipe cannot be archived, or null when it can.
create function private.recipe_archive_blocker(p_recipe_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (
      select 1 from public.menu_items mi join public.menus m on m.id = mi.menu_id
       where mi.recipe_id = p_recipe_id and m.status = 'PUBLISHED') then 'ON_MENU'
    when exists (
      select 1 from public.recipe_ingredients ri
        join public.recipes r on r.current_approved_version_id = ri.recipe_version_id
       where ri.prep_recipe_id = p_recipe_id and r.status = 'ACTIVE' and r.id <> p_recipe_id) then 'IN_USE'
    when exists (
      select 1 from public.recipe_versions
       where recipe_id = p_recipe_id and status = 'PENDING') then 'VERSION_PENDING'
  end;
$$;

create or replace function private.apply_change(
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_changes jsonb
) returns void
language plpgsql set search_path = '' as $$
declare
  v_m public.materials;
  v_p public.packaging_items;
  v_r public.recipes;
  v_blocker text;
begin
  if p_entity_type = 'MATERIAL' then
    select * into v_m from public.materials where id = p_entity_id for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = '22023';
    end if;
    if p_action = 'EDIT' then
      if v_m.status <> 'APPROVED' then
        raise exception 'NOT_EDITABLE' using errcode = '22023';
      end if;
      v_m := jsonb_populate_record(v_m, p_changes);
      update public.materials
         set name = v_m.name, brand = v_m.brand, no_brand = v_m.no_brand,
             specification = v_m.specification, material_type_id = v_m.material_type_id,
             description = v_m.description, abv = v_m.abv, bx = v_m.bx,
             is_coffee_bean = v_m.is_coffee_bean, photo_asset_id = v_m.photo_asset_id,
             updated_by = auth.uid()
       where id = p_entity_id;
    elsif p_action = 'ARCHIVE' then
      if v_m.status not in ('APPROVED', 'RETURNED') then
        raise exception 'NOT_ARCHIVABLE' using errcode = '22023';
      end if;
      if private.recipes_using(p_entity_id, null) > 0 then
        raise exception 'IN_USE' using errcode = '22023';
      end if;
      update public.materials set status = 'ARCHIVED', updated_by = auth.uid() where id = p_entity_id;
    elsif p_action = 'RESTORE' then
      if v_m.status <> 'ARCHIVED' then
        raise exception 'NOT_ARCHIVED' using errcode = '22023';
      end if;
      update public.materials
         set status = case when approved_at is not null then 'APPROVED' else 'RETURNED' end::public.approval_status,
             updated_by = auth.uid()
       where id = p_entity_id;
    end if;
  elsif p_entity_type = 'PACKAGING_ITEM' then
    select * into v_p from public.packaging_items where id = p_entity_id for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = '22023';
    end if;
    if p_action = 'EDIT' then
      if v_p.status <> 'APPROVED' then
        raise exception 'NOT_EDITABLE' using errcode = '22023';
      end if;
      v_p := jsonb_populate_record(v_p, p_changes);
      update public.packaging_items
         set name = v_p.name, brand = v_p.brand, description = v_p.description
       where id = p_entity_id;
    elsif p_action = 'ARCHIVE' then
      if v_p.status not in ('APPROVED', 'RETURNED') then
        raise exception 'NOT_ARCHIVABLE' using errcode = '22023';
      end if;
      if private.recipes_using(null, p_entity_id) > 0 then
        raise exception 'IN_USE' using errcode = '22023';
      end if;
      update public.packaging_items set status = 'ARCHIVED' where id = p_entity_id;
    elsif p_action = 'RESTORE' then
      if v_p.status <> 'ARCHIVED' then
        raise exception 'NOT_ARCHIVED' using errcode = '22023';
      end if;
      update public.packaging_items
         set status = case when approved_at is not null then 'APPROVED' else 'RETURNED' end::public.approval_status
       where id = p_entity_id;
    end if;
  elsif p_entity_type = 'RECIPE' then
    -- Recipe edits are new versions; only archive and restore come through here.
    select * into v_r from public.recipes where id = p_entity_id for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = '22023';
    end if;
    if p_action = 'ARCHIVE' then
      if v_r.status <> 'ACTIVE' then
        raise exception 'NOT_ARCHIVABLE' using errcode = '22023';
      end if;
      v_blocker := private.recipe_archive_blocker(p_entity_id);
      if v_blocker is not null then
        raise exception '%', v_blocker using errcode = '22023';
      end if;
      update public.recipes set status = 'ARCHIVED' where id = p_entity_id;
    elsif p_action = 'RESTORE' then
      if v_r.status <> 'ARCHIVED' then
        raise exception 'NOT_ARCHIVED' using errcode = '22023';
      end if;
      update public.recipes set status = 'ACTIVE' where id = p_entity_id;
    else
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  else
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  -- An archived item has nothing left to change.
  if p_action = 'ARCHIVE' then
    update public.change_requests set status = 'WITHDRAWN'
     where entity_type = p_entity_type and entity_id = p_entity_id and status = 'PENDING';
  end if;
end;
$$;

-- Same as before, plus recipes: only ARCHIVE, only for outlets the caller manages,
-- and direct when nothing of the recipe is live yet (no approved version).
create or replace function public.request_change(
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_changes jsonb default null,
  p_reason text default null
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
  v_changes jsonb;
  v_old jsonb;
  v_direct boolean;
  v_outlet uuid;
begin
  perform private.require_admin_or_manager();
  if p_entity_type not in ('MATERIAL', 'PACKAGING_ITEM', 'RECIPE') or p_action not in ('EDIT', 'ARCHIVE')
     or (p_entity_type = 'RECIPE' and p_action <> 'ARCHIVE') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  v_row := private.entity_row(p_entity_type, p_entity_id);
  if v_row is null then
    raise exception 'NOT_FOUND' using errcode = '22023';
  end if;
  if p_entity_type = 'RECIPE' then
    v_outlet := (v_row ->> 'outlet_id')::uuid;
    if not private.can_manage_outlet(v_outlet) then
      raise exception 'NOT_ALLOWED' using errcode = '42501';
    end if;
  end if;

  if p_action = 'EDIT' then
    select coalesce(jsonb_object_agg(key, value), '{}') into v_changes
      from jsonb_each(coalesce(p_changes, '{}'))
     where key = any (private.editable_fields(p_entity_type))
       and value is distinct from coalesce(v_row -> key, 'null');
    if v_changes = '{}' then
      raise exception 'NO_CHANGES' using errcode = '22023';
    end if;
    select jsonb_object_agg(key, coalesce(v_row -> key, 'null')) into v_old
      from jsonb_object_keys(v_changes) key;
  end if;

  -- Admins change anything directly; a creator archives their own returned item;
  -- a recipe with nothing approved is archived directly by its outlet's Manager.
  v_direct := private.is_admin()
    or (p_action = 'ARCHIVE' and v_row ->> 'status' = 'RETURNED'
        and v_row ->> 'created_by' = auth.uid()::text)
    or (p_entity_type = 'RECIPE' and v_row ->> 'current_approved_version_id' is null);
  if not v_direct and v_row ->> 'status' = 'RETURNED' then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if v_direct then
    perform private.apply_change(p_entity_type, p_entity_id, p_action, v_changes);
    insert into public.change_requests
      (entity_type, entity_id, outlet_id, action, changes, old_values, reason, status, reviewed_by, reviewed_at)
    values
      (p_entity_type, p_entity_id, v_outlet, p_action, v_changes, v_old,
       nullif(btrim(coalesce(p_reason, '')), ''), 'APPROVED', auth.uid(), now());
    return 'APPLIED';
  end if;

  if p_action = 'ARCHIVE' then
    perform private.require_reason(p_reason);
  end if;
  if exists (select 1 from public.change_requests
              where entity_type = p_entity_type and entity_id = p_entity_id and status = 'PENDING') then
    raise exception 'REQUEST_ALREADY_PENDING' using errcode = '22023';
  end if;
  -- Try the change and roll it back, so a request that could never be approved
  -- (duplicate name, item in use) is refused now rather than at review.
  begin
    perform private.apply_change(p_entity_type, p_entity_id, p_action, v_changes);
    raise exception 'DRY_RUN_OK';
  exception when raise_exception then
    if sqlerrm <> 'DRY_RUN_OK' then
      raise;
    end if;
  end;
  insert into public.change_requests (entity_type, entity_id, outlet_id, action, changes, old_values, reason)
  values (p_entity_type, p_entity_id, v_outlet, p_action, v_changes, v_old,
          nullif(btrim(coalesce(p_reason, '')), ''));
  return 'REQUESTED';
end;
$$;

create or replace function public.restore_archived(p_entity_type text, p_entity_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_entity_type not in ('MATERIAL', 'PACKAGING_ITEM', 'RECIPE') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  perform private.apply_change(p_entity_type, p_entity_id, 'RESTORE', null);
  insert into public.change_requests (entity_type, entity_id, outlet_id, action, status, reviewed_by, reviewed_at)
  values (p_entity_type, p_entity_id,
          case when p_entity_type = 'RECIPE' then (select outlet_id from public.recipes where id = p_entity_id) end,
          'RESTORE', 'APPROVED', auth.uid(), now());
end;
$$;

-- Admin edit of an approved recipe: submit and approve the new version together ------

-- Returns {"errors": [...]} without changing anything when fields are missing; approval
-- problems (cost incomplete, Prep not approved) raise as in approve_recipe_version.
create function public.publish_recipe_version(
  p_version_id uuid,
  p_revision integer,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  perform private.require_admin();
  if p_idempotency_key is not null and exists (
    select 1 from public.approval_events where idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('status', 'APPROVED', 'version_id', p_version_id, 'repeated', true);
  end if;
  v_result := public.submit_recipe_version(p_version_id, p_revision);
  if v_result ? 'errors' then
    return v_result;
  end if;
  return public.approve_recipe_version(p_version_id, p_idempotency_key);
end;
$$;

-- Change log of one recipe -------------------------------------------------------------
-- Versions started, approval events and archive requests, with the names of the people
-- involved (profiles are otherwise visible only to Admins).

create function public.recipe_change_log(p_recipe_id uuid)
returns table (
  happened_at timestamptz,
  actor_name text,
  source text,
  version_no integer,
  action text,
  reason text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.recipes r where r.id = p_recipe_id and private.can_manage_outlet(r.outlet_id)
  ) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return query
  select v.created_at, pr.full_name, 'VERSION', v.version_no,
         case when v.based_on_version_id is null then 'CREATE' else 'NEW_VERSION' end, v.change_summary
    from public.recipe_versions v
    left join public.profiles pr on pr.id = v.created_by
   where v.recipe_id = p_recipe_id
  union all
  select e.created_at, pr.full_name, 'APPROVAL', v.version_no, e.action, e.reason
    from public.approval_events e
    join public.recipe_versions v on v.id = e.entity_id
    left join public.profiles pr on pr.id = e.actor_id
   where e.entity_type = 'RECIPE_VERSION' and v.recipe_id = p_recipe_id
  union all
  -- DIRECT: the Admin (or the Manager of a recipe with nothing approved) changed it at once.
  select c.created_at, pr.full_name, 'REQUEST', null,
         c.action || ':' || case when c.reviewed_by = c.requested_by then 'DIRECT' else c.status end, c.reason
    from public.change_requests c
    left join public.profiles pr on pr.id = c.requested_by
   where c.entity_type = 'RECIPE' and c.entity_id = p_recipe_id
  union all
  select c.reviewed_at, pr.full_name, 'REVIEW', null, c.action || ':' || c.status, c.review_reason
    from public.change_requests c
    left join public.profiles pr on pr.id = c.reviewed_by
   where c.entity_type = 'RECIPE' and c.entity_id = p_recipe_id
     and c.status in ('APPROVED', 'RETURNED') and c.reviewed_by is distinct from c.requested_by
   order by 1 desc;
end;
$$;

revoke execute on function
  public.publish_recipe_version(uuid, integer, text),
  public.recipe_change_log(uuid)
from public, anon;
grant execute on function
  public.publish_recipe_version(uuid, integer, text),
  public.recipe_change_log(uuid)
to authenticated;
grant execute on function private.recipe_archive_blocker(uuid) to authenticated;
