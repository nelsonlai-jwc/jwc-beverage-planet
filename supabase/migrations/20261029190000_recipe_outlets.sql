-- Recipes for several outlets, or for all outlets.
-- Decided with Nelson 2026-10-29:
--   * Staff see only their own outlet's recipes and menus (unchanged: published menus).
--   * A Manager sees the recipes of the outlets they manage; the all-outlet catalogue is gone.
--   * A new recipe can be made for several outlets (ticked on create); an Admin can also
--     make it for all outlets. Only an Admin changes them later (set_recipe_outlets).
--   * A Manager edits a recipe only when they manage every one of its outlets; otherwise
--     they can only read it. Only an Admin edits an all-outlet recipe.
-- recipes.outlet_id stays as the recipe's first outlet: approval events, cost snapshots
-- and media paths keep using it.

alter table public.recipes add column all_outlets boolean not null default false;

create table public.recipe_outlets (
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  outlet_id uuid not null references public.outlets (id) on delete restrict,
  primary key (recipe_id, outlet_id)
);
create index recipe_outlets_outlet_idx on public.recipe_outlets (outlet_id);

insert into public.recipe_outlets (recipe_id, outlet_id)
select id, outlet_id from public.recipes;

-- Every recipe made for named outlets lists at least its first outlet (also for copies).
create function private.recipes_first_outlet() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not new.all_outlets then
    insert into public.recipe_outlets (recipe_id, outlet_id) values (new.id, new.outlet_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger recipes_first_outlet after insert on public.recipes
  for each row execute function private.recipes_first_outlet();

create or replace function private.recipes_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.is_prep <> old.is_prep
     or (private.is_api_caller() and (new.outlet_id <> old.outlet_id or new.all_outlets <> old.all_outlets)) then
    raise exception 'Recipe outlet and type are fixed; copy the recipe instead' using errcode = '23514';
  end if;
  if private.is_api_caller() and (
       new.current_approved_version_id is distinct from old.current_approved_version_id
       or new.status <> old.status) then
    raise exception 'Recipe status changes must use the approval workflow' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Visibility -------------------------------------------------------------

create function private.recipe_covers_outlet(p_recipe_id uuid, p_outlet_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.recipes r
     where r.id = p_recipe_id
       and (r.all_outlets or exists (
             select 1 from public.recipe_outlets ro
              where ro.recipe_id = r.id and ro.outlet_id = p_outlet_id))
  );
$$;

-- Admin, or a Manager of at least one of the recipe's outlets.
create function private.can_see_recipe(p_recipe_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or (
    private.is_manager() and exists (
      select 1 from public.recipes r
       where r.id = p_recipe_id
         and (r.all_outlets or exists (
               select 1 from public.recipe_outlets ro
                 join public.user_outlets uo on uo.outlet_id = ro.outlet_id and uo.user_id = auth.uid()
                where ro.recipe_id = r.id))
    )
  );
$$;

-- Admin, or a Manager of every one of the recipe's outlets (never an all-outlet recipe).
create function private.can_manage_recipe(p_recipe_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or (
    private.is_manager() and exists (
      select 1 from public.recipes r
       where r.id = p_recipe_id
         and not r.all_outlets
         and not exists (
               select 1 from public.recipe_outlets ro
                where ro.recipe_id = r.id
                  and not exists (
                        select 1 from public.user_outlets uo
                         where uo.user_id = auth.uid() and uo.outlet_id = ro.outlet_id))
    )
  );
$$;

grant execute on function private.recipe_covers_outlet(uuid, uuid) to authenticated;
grant execute on function private.can_see_recipe(uuid) to authenticated;
grant execute on function private.can_manage_recipe(uuid) to authenticated;

create or replace function private.can_view_recipe(p_recipe_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_see_recipe(p_recipe_id)
      or p_recipe_id in (select private.barista_visible_recipe_ids());
$$;

create or replace function private.can_view_recipe_version(p_version_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.recipe_versions v
      join public.recipes r on r.id = v.recipe_id
     where v.id = p_version_id
       and (
         private.can_see_recipe(r.id)
         or (v.id = r.current_approved_version_id and r.id in (select private.barista_visible_recipe_ids()))
       )
  );
$$;

create or replace function private.can_edit_recipe_version(p_version_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.recipe_versions v
      join public.recipes r on r.id = v.recipe_id
     where v.id = p_version_id
       and v.status in ('DRAFT', 'RETURNED')
       and private.can_manage_recipe(r.id)
  );
$$;

alter table public.recipe_outlets enable row level security;
create policy recipe_outlets_select on public.recipe_outlets for select to authenticated
  using (private.can_view_recipe(recipe_id));
grant select on public.recipe_outlets to authenticated;
revoke insert, update, delete on public.recipe_outlets from anon, authenticated;

drop policy recipes_delete_draft on public.recipes;
create policy recipes_delete_draft on public.recipes for delete to authenticated
  using (private.can_manage_recipe(id)
         and current_approved_version_id is null
         and not exists (select 1 from public.recipe_versions v
                          where v.recipe_id = recipes.id and v.status <> 'DRAFT'));

drop policy recipe_versions_insert on public.recipe_versions;
create policy recipe_versions_insert on public.recipe_versions for insert to authenticated
  with check (created_by = auth.uid() and private.can_manage_recipe(recipe_id));
drop policy recipe_versions_update on public.recipe_versions;
create policy recipe_versions_update on public.recipe_versions for update to authenticated
  using (private.can_edit_recipe_version(id))
  with check (private.can_manage_recipe(recipe_id));

-- A Prep must be made for every outlet of the recipe that uses it; a menu uses only
-- recipes made for its outlet.
create or replace function private.recipe_ingredients_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_parent public.recipes;
  v_prep public.recipes;
begin
  if new.prep_recipe_id is null then
    return new;
  end if;
  select r.* into v_parent
    from public.recipe_versions v join public.recipes r on r.id = v.recipe_id
   where v.id = new.recipe_version_id;
  select * into v_prep from public.recipes where id = new.prep_recipe_id;
  if not v_prep.is_prep then
    raise exception 'Only Prep Material recipes can be used as ingredients' using errcode = '23514';
  end if;
  if not private.recipe_covers_recipe(v_prep.id, v_parent.id) then
    raise exception 'Prep Material must belong to the same outlet (DEPENDENCY_INVALID)'
      using errcode = '23514';
  end if;
  if v_prep.id = v_parent.id then
    raise exception 'A recipe cannot use itself (DEPENDENCY_INVALID)' using errcode = '23514';
  end if;
  -- Indirect cycles are checked by submit and approve (ch. 11).
  return new;
end;
$$;

-- True when p_prep is made for every outlet of p_parent.
create function private.recipe_covers_recipe(p_prep uuid, p_parent uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select all_outlets from public.recipes where id = p_prep)
      or (not (select all_outlets from public.recipes where id = p_parent)
          and not exists (
                select 1 from public.recipe_outlets ro
                 where ro.recipe_id = p_parent
                   and not private.recipe_covers_outlet(p_prep, ro.outlet_id)));
$$;
grant execute on function private.recipe_covers_recipe(uuid, uuid) to authenticated;

create or replace function private.menu_recipe_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_menu_outlet uuid;
  v_recipe public.recipes;
begin
  if tg_table_name = 'menu_items' then
    select outlet_id into v_menu_outlet from public.menus where id = new.menu_id;
  else
    select m.outlet_id into v_menu_outlet
      from public.menu_revisions mr join public.menus m on m.id = mr.menu_id
     where mr.id = new.menu_revision_id;
  end if;
  select * into v_recipe from public.recipes where id = new.recipe_id;
  if not private.recipe_covers_outlet(v_recipe.id, v_menu_outlet) then
    raise exception 'Menus can only use recipes of the same outlet; copy it first'
      using errcode = '23514';
  end if;
  if v_recipe.is_prep then
    raise exception 'Prep Material cannot be sold on a menu' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Creating ---------------------------------------------------------------

drop function public.create_recipe(uuid, boolean, text);
create function public.create_recipe(
  p_outlet_ids uuid[],
  p_all_outlets boolean,
  p_is_prep boolean,
  p_product_name text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_outlets uuid[] := array(select distinct unnest(coalesce(p_outlet_ids, '{}')));
  v_first uuid;
  v_recipe_id uuid := gen_random_uuid();
  v_version_id uuid := gen_random_uuid();
begin
  perform private.require_admin_or_manager();
  if p_all_outlets then
    if not private.is_admin() then
      raise exception 'Only an Admin can make a recipe for all outlets' using errcode = '42501';
    end if;
    v_outlets := '{}';
    select id into v_first from public.outlets where is_active order by sort_order, name limit 1;
  else
    if cardinality(v_outlets) = 0 then
      raise exception 'OUTLET_REQUIRED' using errcode = '23514';
    end if;
    if exists (select 1 from unnest(v_outlets) o where not private.can_manage_outlet(o)) then
      raise exception 'You can only create recipes for outlets you manage' using errcode = '42501';
    end if;
    if (select count(*) from public.outlets where id = any (v_outlets) and is_active)
       <> cardinality(v_outlets) then
      raise exception 'Unknown or inactive outlet' using errcode = '23503';
    end if;
    select id into v_first from public.outlets where id = any (v_outlets) order by sort_order, name limit 1;
  end if;

  insert into public.recipes (id, outlet_id, is_prep, all_outlets)
  values (v_recipe_id, v_first, p_is_prep, coalesce(p_all_outlets, false));
  insert into public.recipe_outlets (recipe_id, outlet_id)
  select v_recipe_id, unnest(v_outlets)
  on conflict do nothing;

  insert into public.recipe_versions (id, recipe_id, version_no, product_name, style)
  values (
    v_version_id, v_recipe_id, 1, nullif(btrim(p_product_name), ''),
    case when p_is_prep then 'PREP_MATERIAL'::public.beverage_style end
  );

  return v_version_id;
end;
$$;
revoke execute on function public.create_recipe(uuid[], boolean, boolean, text) from public, anon;
grant execute on function public.create_recipe(uuid[], boolean, boolean, text) to authenticated;

-- An Admin changes a recipe's outlets; applies at once and is logged as a direct EDIT.
-- Refused when a menu of a removed outlet still lists it (OUTLET_ON_MENU), when a recipe
-- using this Prep needs a removed outlet (OUTLET_NEEDED), or when a Prep it uses does not cover the
-- new outlets (PREP_NOT_COVERED).
create function private.recipe_outlets_label(p_recipe_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when r.all_outlets then 'ALL_OUTLETS' else (
           select string_agg(o.name, ', ' order by o.sort_order, o.name)
             from public.recipe_outlets ro join public.outlets o on o.id = ro.outlet_id
            where ro.recipe_id = r.id) end
    from public.recipes r where r.id = p_recipe_id;
$$;

create function public.set_recipe_outlets(p_recipe_id uuid, p_outlet_ids uuid[], p_all_outlets boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_outlets uuid[] := array(select distinct unnest(coalesce(p_outlet_ids, '{}')));
  v_all boolean := coalesce(p_all_outlets, false);
  v_recipe public.recipes;
  v_old text;
  v_new text;
begin
  perform private.require_admin();
  select * into v_recipe from public.recipes where id = p_recipe_id for update;
  if v_recipe.id is null then
    raise exception 'NOT_FOUND' using errcode = '22023';
  end if;
  if v_all then
    v_outlets := '{}';
  else
    if cardinality(v_outlets) = 0 then
      raise exception 'OUTLET_REQUIRED' using errcode = '23514';
    end if;
    if (select count(*) from public.outlets where id = any (v_outlets) and is_active)
       <> cardinality(v_outlets) then
      raise exception 'Unknown or inactive outlet' using errcode = '23503';
    end if;
  end if;
  v_old := private.recipe_outlets_label(p_recipe_id);

  update public.recipes
     set all_outlets = v_all,
         outlet_id = case when v_all then outlet_id else
           (select id from public.outlets where id = any (v_outlets) order by sort_order, name limit 1) end
   where id = p_recipe_id;
  delete from public.recipe_outlets where recipe_id = p_recipe_id;
  insert into public.recipe_outlets (recipe_id, outlet_id)
  select p_recipe_id, unnest(v_outlets);

  if exists (
    select 1 from public.menu_items mi join public.menus m on m.id = mi.menu_id
     where mi.recipe_id = p_recipe_id and m.status <> 'ARCHIVED'
       and not private.recipe_covers_outlet(p_recipe_id, m.outlet_id)) then
    raise exception 'OUTLET_ON_MENU' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.recipe_ingredients ri
      join public.recipe_versions v on v.id = ri.recipe_version_id
      join public.recipes r on r.id = v.recipe_id
     where ri.prep_recipe_id = p_recipe_id and r.status = 'ACTIVE'
       and (v.id = r.current_approved_version_id or v.status in ('DRAFT', 'PENDING', 'RETURNED'))
       and not private.recipe_covers_recipe(p_recipe_id, r.id)) then
    raise exception 'OUTLET_NEEDED' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.recipe_ingredients ri
      join public.recipe_versions v on v.id = ri.recipe_version_id
     where v.recipe_id = p_recipe_id and ri.prep_recipe_id is not null
       and (v.id = v_recipe.current_approved_version_id or v.status in ('DRAFT', 'PENDING', 'RETURNED'))
       and not private.recipe_covers_recipe(ri.prep_recipe_id, p_recipe_id)) then
    raise exception 'PREP_NOT_COVERED' using errcode = '22023';
  end if;

  v_new := private.recipe_outlets_label(p_recipe_id);
  if v_new is distinct from v_old then
    insert into public.change_requests
      (entity_type, entity_id, outlet_id, action, changes, old_values, reason, status, reviewed_by, reviewed_at)
    values
      ('RECIPE', p_recipe_id, (select outlet_id from public.recipes where id = p_recipe_id), 'EDIT',
       jsonb_build_object('outlets', v_new), jsonb_build_object('outlets', v_old),
       v_old || ' → ' || v_new, 'APPROVED', auth.uid(), now());
  end if;
end;
$$;
revoke execute on function public.set_recipe_outlets(uuid, uuid[], boolean) from public, anon;
grant execute on function public.set_recipe_outlets(uuid, uuid[], boolean) to authenticated;

-- Workflow, copy, reports and usage follow the recipe's outlets ----------

CREATE OR REPLACE FUNCTION private.copy_recipe_tree(p_source_recipe_id uuid, p_target_outlet_id uuid, p_product_name text, p_mapping jsonb, p_key text, p_depth integer, INOUT p_done jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  src public.recipes;
  sv public.recipe_versions;
  v_recipe uuid;
  v_version uuid;
  ing record;
  v_prep uuid;
  v_sub jsonb;
begin
  if p_depth > 10 then
    raise exception 'Prep dependencies are nested too deeply' using errcode = '23514';
  end if;
  select * into src from public.recipes where id = p_source_recipe_id;
  if src.current_approved_version_id is null or src.status <> 'ACTIVE' then
    raise exception 'Only approved, active recipes can be copied' using errcode = '23514';
  end if;
  select * into sv from public.recipe_versions where id = src.current_approved_version_id;

  insert into public.recipes (outlet_id, is_prep) values (p_target_outlet_id, src.is_prep)
  returning id into v_recipe;
  -- Record before copying dependencies so a shared Prep is copied once.
  p_done := p_done || jsonb_build_object(p_source_recipe_id::text, v_recipe);

  insert into public.recipe_versions (
    recipe_id, version_no, product_name, purpose, style, temperature, yield_quantity, yield_unit,
    appearance_notes, taste_sour, taste_sweet, taste_bitter, taste_salty, taste_umami, taste_spicy,
    taste_smoky, taste_zesty, taste_funky, taste_earthy, taste_oily, cup_type, serving_size,
    garnish, storage_method, shelf_life, tasting_notes, updated_by)
  values (
    v_recipe, 1, coalesce(nullif(btrim(p_product_name), ''), sv.product_name), sv.purpose, sv.style,
    sv.temperature, sv.yield_quantity, sv.yield_unit, sv.appearance_notes, sv.taste_sour,
    sv.taste_sweet, sv.taste_bitter, sv.taste_salty, sv.taste_umami, sv.taste_spicy, sv.taste_smoky,
    sv.taste_zesty, sv.taste_funky, sv.taste_earthy, sv.taste_oily, sv.cup_type, sv.serving_size,
    sv.garnish, sv.storage_method, sv.shelf_life, sv.tasting_notes, auth.uid())
  returning id into v_version;

  for ing in
    select * from public.recipe_ingredients where recipe_version_id = sv.id order by sort_order
  loop
    v_prep := null;
    if ing.prep_recipe_id is not null then
      if p_mapping ? ing.prep_recipe_id::text then
        v_prep := (p_mapping ->> ing.prep_recipe_id::text)::uuid;
        if not exists (
          select 1 from public.recipes
           where id = v_prep and is_prep and status = 'ACTIVE'
             and private.recipe_covers_outlet(id, p_target_outlet_id)
        ) then
          raise exception 'Mapped Prep Material must be an active Prep recipe of the target outlet'
            using errcode = '23514';
        end if;
      elsif p_done ? ing.prep_recipe_id::text then
        v_prep := (p_done ->> ing.prep_recipe_id::text)::uuid;
      else
        v_sub := private.copy_recipe_tree(
          ing.prep_recipe_id, p_target_outlet_id, null, p_mapping, p_key, p_depth + 1, p_done);
        p_done := v_sub;
        v_prep := (p_done ->> ing.prep_recipe_id::text)::uuid;
      end if;
    end if;
    insert into public.recipe_ingredients (recipe_version_id, sort_order, material_id, prep_recipe_id, quantity, unit, notes)
    values (v_version, ing.sort_order, ing.material_id, v_prep, ing.quantity, ing.unit, ing.notes);
  end loop;

  insert into public.recipe_packaging (recipe_version_id, sort_order, packaging_item_id, pieces)
  select v_version, sort_order, packaging_item_id, pieces
    from public.recipe_packaging where recipe_version_id = sv.id;
  insert into public.recipe_steps (recipe_version_id, step_no, instruction, media_asset_id)
  select v_version, step_no, instruction, media_asset_id
    from public.recipe_steps where recipe_version_id = sv.id;
  -- Photos are shared by reference; media files are never changed after upload.
  insert into public.recipe_media (recipe_version_id, sort_order, media_asset_id)
  select v_version, sort_order, media_asset_id
    from public.recipe_media where recipe_version_id = sv.id;

  insert into public.recipe_copy_provenance (
    target_recipe_id, target_version_id, source_recipe_id, source_version_id, source_outlet_id,
    copied_by, idempotency_key)
  values (
    v_recipe, v_version, src.id, sv.id, src.outlet_id, auth.uid(),
    case when p_key is not null then p_key || ':' || src.id end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.copy_recipe(p_source_recipe_id uuid, p_target_outlet_id uuid, p_product_name text, p_prep_mapping jsonb, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_done jsonb;
  v_prov public.recipe_copy_provenance;
begin
  if not private.can_manage_outlet(p_target_outlet_id) then
    raise exception 'You can only copy into an outlet you manage' using errcode = '42501';
  end if;
  if not private.can_view_recipe(p_source_recipe_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_idempotency_key is not null then
    select * into v_prov from public.recipe_copy_provenance
     where idempotency_key = p_idempotency_key || ':' || p_source_recipe_id;
    if v_prov.id is not null then
      return jsonb_build_object('recipe_id', v_prov.target_recipe_id,
                                'version_id', v_prov.target_version_id, 'repeated', true);
    end if;
  end if;

  v_done := private.copy_recipe_tree(
    p_source_recipe_id, p_target_outlet_id, p_product_name,
    coalesce(p_prep_mapping, '{}'), p_idempotency_key, 1, '{}');

  return jsonb_build_object(
    'recipe_id', v_done ->> p_source_recipe_id::text,
    'version_id', (select id from public.recipe_versions
                    where recipe_id = (v_done ->> p_source_recipe_id::text)::uuid and version_no = 1),
    'copied', v_done);
end;
$function$;

CREATE OR REPLACE FUNCTION public.request_change(p_entity_type text, p_entity_id uuid, p_action text, p_changes jsonb DEFAULT NULL::jsonb, p_reason text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    if not private.can_manage_recipe(p_entity_id) then
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
$function$;

CREATE OR REPLACE FUNCTION public.submit_recipe_version(p_version_id uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.recipe_versions;
  v_outlet uuid;
  v_errors jsonb;
begin
  select * into v from public.recipe_versions where id = p_version_id for update;
  select outlet_id into v_outlet from public.recipes where id = v.recipe_id;
  if v.id is null or not private.can_manage_recipe(v.recipe_id) then
    raise exception 'You cannot submit this recipe' using errcode = '42501';
  end if;
  if v.status not in ('DRAFT', 'RETURNED') then
    raise exception 'Only a draft or returned version can be submitted' using errcode = '23514';
  end if;
  if v.revision <> p_revision then
    raise exception 'Someone else saved this draft; reload to see their changes' using errcode = '40001';
  end if;

  v_errors := private.validate_recipe_version(p_version_id);
  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('errors', v_errors);
  end if;

  update public.recipe_versions
     set status = 'PENDING', submitted_by = auth.uid(), submitted_at = now(), updated_by = auth.uid()
   where id = p_version_id;
  insert into public.approval_events (entity_type, entity_id, outlet_id, action, actor_id)
  values ('RECIPE_VERSION', p_version_id, v_outlet, 'SUBMIT', auth.uid());

  return jsonb_build_object('status', 'PENDING');
end;
$function$;

CREATE OR REPLACE FUNCTION public.withdraw_recipe_version(p_version_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.recipe_versions;
  v_outlet uuid;
begin
  select * into v from public.recipe_versions where id = p_version_id for update;
  select outlet_id into v_outlet from public.recipes where id = v.recipe_id;
  if v.id is null or v.submitted_by is distinct from auth.uid() or not private.can_manage_recipe(v.recipe_id) then
    raise exception 'Only the person who submitted can withdraw' using errcode = '42501';
  end if;
  if v.status <> 'PENDING' then
    raise exception 'Only a pending version can be withdrawn' using errcode = '23514';
  end if;

  update public.recipe_versions set status = 'DRAFT', updated_by = auth.uid() where id = p_version_id;
  insert into public.approval_events (entity_type, entity_id, outlet_id, action, actor_id)
  values ('RECIPE_VERSION', p_version_id, v_outlet, 'WITHDRAW', auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.report_current_costs(p_outlet_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(recipe_id uuid, outlet_id uuid, version_id uuid, cost jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
       and (p_outlet_id is null or private.recipe_covers_outlet(rc.id, p_outlet_id))
       and private.can_see_recipe(rc.id)
  loop
    recipe_id := r.id;
    outlet_id := r.outlet_id;
    version_id := r.current_approved_version_id;
    cost := private.recipe_cost_tree(r.current_approved_version_id, array[r.id]);
    return next;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.report_version_people()
 RETURNS TABLE(id uuid, full_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select distinct p.id, p.full_name
    from public.recipe_versions v
    join public.recipes r on r.id = v.recipe_id
    join public.profiles p on p.id in (v.created_by, v.submitted_by, v.approved_by)
   where private.current_user_role() in ('ADMIN', 'MANAGER')
     and private.can_see_recipe(r.id);
$function$;

CREATE OR REPLACE FUNCTION public.item_usage(p_material_id uuid, p_packaging_item_id uuid)
 RETURNS TABLE(recipe_id uuid, product_name text, outlet_name text, is_prep boolean, usage text, via_prep_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_admin_or_manager();
  return query
  with recursive live (recipe_id, via_prep) as (
    select r.id, null::uuid
      from public.recipes r
      join public.recipe_ingredients ri on ri.recipe_version_id = r.current_approved_version_id
     where r.status = 'ACTIVE' and ri.material_id = p_material_id
    union
    select r.id, null::uuid
      from public.recipes r
      join public.recipe_packaging rp on rp.recipe_version_id = r.current_approved_version_id
     where r.status = 'ACTIVE' and rp.packaging_item_id = p_packaging_item_id
    union
    select r.id, l.recipe_id
      from live l
      join public.recipe_ingredients ri on ri.prep_recipe_id = l.recipe_id
      join public.recipes r on r.current_approved_version_id = ri.recipe_version_id
     where r.status = 'ACTIVE'
  ),
  drafts (recipe_id) as (
    select distinct v.recipe_id
      from public.recipe_versions v
      join public.recipes r on r.id = v.recipe_id
     where r.status = 'ACTIVE' and v.status in ('DRAFT', 'PENDING', 'RETURNED')
       and (exists (select 1 from public.recipe_ingredients ri
                     where ri.recipe_version_id = v.id and ri.material_id = p_material_id)
            or exists (select 1 from public.recipe_packaging rp
                        where rp.recipe_version_id = v.id and rp.packaging_item_id = p_packaging_item_id))
  ),
  uses (recipe_id, usage, via_prep) as (
    (select distinct on (l.recipe_id) l.recipe_id, 'LIVE', l.via_prep
       from live l order by l.recipe_id, l.via_prep nulls first)
    union all
    select d.recipe_id, 'DRAFT', null::uuid
      from drafts d where not exists (select 1 from live l where l.recipe_id = d.recipe_id)
  )
  select u.recipe_id,
         coalesce(av.product_name, lv.product_name),
         case when r.all_outlets then null else (
           select string_agg(o.name, ', ' order by o.sort_order, o.name)
             from public.recipe_outlets ro join public.outlets o on o.id = ro.outlet_id
            where ro.recipe_id = r.id) end,
         r.is_prep,
         u.usage,
         pv.product_name
    from uses u
    join public.recipes r on r.id = u.recipe_id
    left join public.recipe_versions av on av.id = r.current_approved_version_id
    left join lateral (
      select v.product_name from public.recipe_versions v
       where v.recipe_id = r.id order by v.version_no desc limit 1) lv on true
    left join public.recipes pr on pr.id = u.via_prep
    left join public.recipe_versions pv on pv.id = pr.current_approved_version_id
   order by u.usage desc, 3, 2;
end;
$function$;

-- Approval cost snapshots carry the recipe's first outlet; Managers of its other outlets
-- read them too.
drop policy cost_snapshots_select on public.cost_snapshots;
create policy cost_snapshots_select on public.cost_snapshots for select to authenticated
  using (private.can_manage_outlet(outlet_id)
         or exists (select 1 from public.recipe_versions v
                     where v.id = recipe_version_id and private.can_see_recipe(v.recipe_id)));
drop policy cost_snapshot_lines_select on public.cost_snapshot_lines;
create policy cost_snapshot_lines_select on public.cost_snapshot_lines for select to authenticated
  using (exists (select 1 from public.cost_snapshots s where s.id = snapshot_id));
