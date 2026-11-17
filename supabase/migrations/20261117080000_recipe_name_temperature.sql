-- Drink names without temperature (Nelson, 2026-11-17).
--   * Drink names no longer carry Hot / Cold / Frozen; the app shows the temperature after the
--     name, e.g. "Matcha Latte (Hot)". Same name with a different temperature = a different drink.
--   * Two active drinks that share an outlet may not have the same name (case and spacing
--     ignored) and the same temperature. Checked on submit and approval (DUPLICATE_NAME on the
--     product name) and when an Admin changes a recipe's outlets. Compared against the other
--     drinks' approved and pending versions. Preps are not checked.
--   * Same-name sync groups drinks by name + temperature (Preps by name only).

-- Two recipes share an outlet when either is for all outlets or they list a common outlet.
create function private.recipes_share_outlet(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.recipes where id in (p_a, p_b) and all_outlets)
      or exists (
        select 1 from public.recipe_outlets a
          join public.recipe_outlets b on b.outlet_id = a.outlet_id
         where a.recipe_id = p_a and b.recipe_id = p_b);
$$;

-- Another active drink sharing an outlet already uses this name and temperature.
create function private.recipe_name_taken(p_recipe_id uuid, p_name text, p_temp public.beverage_temp)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.recipes r
      join public.recipe_versions v on v.recipe_id = r.id
     where r.id <> p_recipe_id and r.status = 'ACTIVE' and not r.is_prep
       and (v.id = r.current_approved_version_id or v.status = 'PENDING')
       and v.temperature = p_temp
       and private.recipe_name_key(v.product_name) = private.recipe_name_key(p_name)
       and private.recipes_share_outlet(r.id, p_recipe_id));
$$;

revoke execute on function private.recipes_share_outlet(uuid, uuid) from public, anon;
revoke execute on function private.recipe_name_taken(uuid, text, public.beverage_temp) from public, anon;

CREATE OR REPLACE FUNCTION private.validate_recipe_version(p_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.recipe_versions;
  v_is_prep boolean;
  v_errors jsonb := '[]';
begin
  select * into v from public.recipe_versions where id = p_version_id;
  select is_prep into v_is_prep from public.recipes where id = v.recipe_id;

  if v.product_name is null then
    v_errors := v_errors || jsonb_build_object('code', 'PRODUCT_NAME_REQUIRED', 'field', 'product_name');
  end if;
  if v.style is null then
    v_errors := v_errors || jsonb_build_object('code', 'STYLE_REQUIRED', 'field', 'style');
  end if;
  if not v_is_prep and v.temperature is null then
    v_errors := v_errors || jsonb_build_object('code', 'TEMPERATURE_REQUIRED', 'field', 'temperature');
  end if;
  -- Same outlet: no two drinks with the same name and temperature.
  if not v_is_prep and v.product_name is not null and v.temperature is not null
     and private.recipe_name_taken(v.recipe_id, v.product_name, v.temperature) then
    v_errors := v_errors || jsonb_build_object('code', 'DUPLICATE_NAME', 'field', 'product_name');
  end if;
  if v_is_prep and v.yield_quantity is null then
    v_errors := v_errors || jsonb_build_object('code', 'YIELD_REQUIRED', 'field', 'yield_quantity');
  end if;

  if not exists (select 1 from public.recipe_ingredients where recipe_version_id = p_version_id) then
    v_errors := v_errors || jsonb_build_object('code', 'INGREDIENT_REQUIRED', 'field', 'ingredients');
  end if;
  select v_errors || coalesce(jsonb_agg(e order by e ->> 'line'), '[]') into v_errors
    from (
      select jsonb_build_object('code', 'QUANTITY_REQUIRED', 'field', 'ingredients', 'line', ri.sort_order) e
        from public.recipe_ingredients ri
       where ri.recipe_version_id = p_version_id and (ri.quantity is null or ri.unit is null)
      union all
      select jsonb_build_object('code', 'MATERIAL_NOT_APPROVED', 'field', 'ingredients', 'line', ri.sort_order)
        from public.recipe_ingredients ri
        join public.materials m on m.id = ri.material_id
       where ri.recipe_version_id = p_version_id and m.status <> 'APPROVED'
      union all
      select jsonb_build_object('code', 'PREP_ARCHIVED', 'field', 'ingredients', 'line', ri.sort_order)
        from public.recipe_ingredients ri
        join public.recipes p on p.id = ri.prep_recipe_id
       where ri.recipe_version_id = p_version_id and p.status <> 'ACTIVE'
      union all
      select jsonb_build_object('code', 'PACKAGING_NOT_APPROVED', 'field', 'packaging', 'line', rp.sort_order)
        from public.recipe_packaging rp
        join public.packaging_items pi on pi.id = rp.packaging_item_id
       where rp.recipe_version_id = p_version_id and pi.status <> 'APPROVED'
    ) lines;

  if not exists (
    select 1 from public.recipe_steps
     where recipe_version_id = p_version_id and char_length(btrim(instruction)) > 0
  ) then
    v_errors := v_errors || jsonb_build_object('code', 'STEP_REQUIRED', 'field', 'steps');
  end if;

  -- A photo counts only once the file is really in storage (ch. 20.2).
  if not exists (
    select 1
      from public.recipe_media rm
      join public.media_assets ma on ma.id = rm.media_asset_id
      join storage.objects o on o.bucket_id = ma.bucket and o.name = ma.object_path
     where rm.recipe_version_id = p_version_id and ma.upload_status = 'READY'
  ) then
    v_errors := v_errors || jsonb_build_object('code', 'PHOTO_REQUIRED', 'field', 'photos');
  end if;

  if private.recipe_has_cycle(p_version_id) then
    v_errors := v_errors || jsonb_build_object('code', 'DEPENDENCY_CYCLE', 'field', 'ingredients');
  end if;

  return v_errors;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_recipe_outlets(p_recipe_id uuid, p_outlet_ids uuid[], p_all_outlets boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- The new outlets must not already have a drink with the same name and temperature.
  if exists (
    select 1 from public.recipe_versions v
     where v.recipe_id = p_recipe_id and not v_recipe.is_prep
       and (v.id = v_recipe.current_approved_version_id or v.status = 'PENDING')
       and v.product_name is not null and v.temperature is not null
       and private.recipe_name_taken(p_recipe_id, v.product_name, v.temperature)) then
    raise exception 'DUPLICATE_NAME' using errcode = '23505';
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
$function$;

create or replace function public.sync_recipes(p_recipe_ids uuid[], p_content jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_version uuid;
  v_revision integer;
  v_result jsonb;
  v_keys integer;
  v_message text;
  v_detail text;
  v_state text;
  v_photo_recipes uuid[];
  v_photos uuid[];
begin
  perform private.require_admin();  -- Super Admin only since 20261116170000

  if coalesce(cardinality(p_recipe_ids), 0) < 2
     or cardinality(p_recipe_ids) <> (select count(distinct x) from unnest(p_recipe_ids) as x) then
    raise exception 'SYNC_NEED_TWO' using errcode = '23514';
  end if;

  -- Every recipe: active, approved, same name, same kind (drink / Prep) and, for drinks,
  -- same temperature.
  select count(distinct (private.recipe_name_key(v.product_name), r.is_prep,
                        case when r.is_prep then null else v.temperature end))
    into v_keys
    from public.recipes r
    join public.recipe_versions v on v.id = r.current_approved_version_id
   where r.id = any (p_recipe_ids) and r.status = 'ACTIVE';
  if v_keys <> 1 or (
    select count(*) from public.recipes r
     where r.id = any (p_recipe_ids) and r.status = 'ACTIVE' and r.current_approved_version_id is not null
  ) <> cardinality(p_recipe_ids) then
    raise exception 'SYNC_NOT_SAME_NAME' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.recipe_versions
     where recipe_id = any (p_recipe_ids) and status in ('DRAFT', 'PENDING', 'RETURNED')
  ) then
    raise exception 'SYNC_OPEN_VERSION' using errcode = '23514';
  end if;

  -- Photos and step media come only from the ticked recipes' approved versions, read before
  -- any recipe changes.
  v_photo_recipes := array(select (x #>> '{}')::uuid
                             from jsonb_array_elements(coalesce(p_content -> 'photo_recipe_ids', '[]')) as x);
  if not v_photo_recipes <@ p_recipe_ids then
    raise exception 'SYNC_BAD_MEDIA' using errcode = '23514';
  end if;
  select coalesce(array_agg(media_asset_id order by first_pos), '{}') into v_photos
    from (select rm.media_asset_id,
                 min(array_position(v_photo_recipes, r.id) * 1000 + rm.sort_order) as first_pos
            from public.recipes r
            join public.recipe_media rm on rm.recipe_version_id = r.current_approved_version_id
           where r.id = any (v_photo_recipes)
           group by rm.media_asset_id) photos;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_content -> 'steps', '[]')) as s (x)
     where s.x ->> 'media_asset_id' is not null
       and not exists (
         select 1 from public.recipes r
           join public.recipe_steps rs on rs.recipe_version_id = r.current_approved_version_id
          where r.id = any (v_photo_recipes) and rs.media_asset_id = (s.x ->> 'media_asset_id')::uuid)
  ) then
    raise exception 'SYNC_BAD_MEDIA' using errcode = '23514';
  end if;

  foreach v_id in array p_recipe_ids loop
   begin
    -- Starts as a copy of the approved version (name, photos, packaging, notes ...).
    v_version := public.create_recipe_version(v_id);

    update public.recipe_versions set
      style = (p_content ->> 'style')::public.beverage_style,
      temperature = (p_content ->> 'temperature')::public.beverage_temp,
      yield_quantity = (p_content ->> 'yield_quantity')::numeric,
      yield_unit = (p_content ->> 'yield_unit')::public.measure_unit,
      cup_type = nullif(btrim(p_content ->> 'cup_type'), ''),
      serving_size = nullif(btrim(p_content ->> 'serving_size'), ''),
      garnish = nullif(btrim(p_content ->> 'garnish'), ''),
      change_summary = nullif(btrim(p_content ->> 'change_summary'), ''),
      updated_by = auth.uid()
    where id = v_version
    returning revision into v_revision;

    delete from public.recipe_ingredients where recipe_version_id = v_version;
    insert into public.recipe_ingredients (recipe_version_id, sort_order, material_id, prep_recipe_id, quantity, unit, notes)
    select v_version, i.ord, (i.x ->> 'material_id')::uuid, (i.x ->> 'prep_recipe_id')::uuid,
           (i.x ->> 'quantity')::numeric, (i.x ->> 'unit')::public.measure_unit, nullif(btrim(i.x ->> 'notes'), '')
      from jsonb_array_elements(coalesce(p_content -> 'ingredients', '[]')) with ordinality as i (x, ord);

    delete from public.recipe_steps where recipe_version_id = v_version;
    insert into public.recipe_steps (recipe_version_id, step_no, instruction, media_asset_id)
    select v_version, row_number() over (order by s.ord), btrim(s.x ->> 'instruction'),
           (s.x ->> 'media_asset_id')::uuid
      from jsonb_array_elements(coalesce(p_content -> 'steps', '[]')) with ordinality as s (x, ord)
     where char_length(btrim(coalesce(s.x ->> 'instruction', ''))) > 0;

    if cardinality(v_photo_recipes) > 0 then
      delete from public.recipe_media where recipe_version_id = v_version;
      insert into public.recipe_media (recipe_version_id, sort_order, media_asset_id)
      select v_version, p.ord, p.id from unnest(v_photos) with ordinality as p (id, ord);
    end if;

    select revision into v_revision from public.recipe_versions where id = v_version;
    v_result := public.publish_recipe_version(v_version, v_revision, null);
    if v_result ? 'errors' then
      raise exception 'RECIPE_INVALID' using errcode = '23514', detail = (v_result -> 'errors')::text;
    end if;
   exception when others then
      -- Say which recipe failed; the whole sync is rolled back.
      get stacked diagnostics v_message = message_text, v_detail = pg_exception_detail, v_state = returned_sqlstate;
      raise exception '%', v_message using errcode = v_state,
        detail = jsonb_build_object('recipe_id', v_id, 'detail', v_detail)::text;
   end;
  end loop;

  return jsonb_build_object('status', 'SYNCED', 'count', cardinality(p_recipe_ids));
end;
$$;

-- The "used in" list on raw materials / packaging also returns the drink's temperature, so it
-- can show after the name (null for Preps).
drop function public.item_usage(uuid, uuid);
create function public.item_usage(p_material_id uuid, p_packaging_item_id uuid)
returns table (
  recipe_id uuid,
  product_name text,
  outlet_name text,
  is_prep boolean,
  usage text,
  via_prep_name text,
  temperature public.beverage_temp
)
language plpgsql stable security definer set search_path = '' as $$
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
         o.name,
         r.is_prep,
         u.usage,
         pv.product_name,
         case when r.is_prep then null else coalesce(av.temperature, lv.temperature) end
    from uses u
    join public.recipes r on r.id = u.recipe_id
    join public.outlets o on o.id = r.outlet_id
    left join public.recipe_versions av on av.id = r.current_approved_version_id
    left join lateral (
      select v.product_name, v.temperature from public.recipe_versions v
       where v.recipe_id = r.id order by v.version_no desc limit 1) lv on true
    left join public.recipes pr on pr.id = u.via_prep
    left join public.recipe_versions pv on pv.id = pr.current_approved_version_id
   order by u.usage desc, o.name, 2;
end;
$$;
revoke execute on function public.item_usage(uuid, uuid) from public, anon;
grant execute on function public.item_usage(uuid, uuid) to authenticated;
