-- Copy a recipe from the "My outlets" list, including one still in progress.
-- copy_recipe takes an optional source version: the recipe's approved version
-- (the default, as before) or its open Draft / Pending / Returned version.
-- The target outlet may be one the source already covers. A Prep that already
-- covers the target outlet is used as it is instead of being copied.

drop function public.copy_recipe(uuid, uuid, text, jsonb, text);
drop function private.copy_recipe_tree(uuid, uuid, text, jsonb, text, integer, jsonb);

create function private.copy_recipe_tree(
  p_source_recipe_id uuid, p_source_version_id uuid, p_target_outlet_id uuid, p_product_name text,
  p_mapping jsonb, p_key text, p_depth integer, inout p_done jsonb)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
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
  if src.id is null or src.status <> 'ACTIVE' then
    raise exception 'Only active recipes can be copied' using errcode = '23514';
  end if;
  if p_source_version_id is null then
    if src.current_approved_version_id is null then
      raise exception 'Only approved, active recipes can be copied' using errcode = '23514';
    end if;
    select * into sv from public.recipe_versions where id = src.current_approved_version_id;
  else
    select * into sv from public.recipe_versions
     where id = p_source_version_id and recipe_id = src.id
       and (id = src.current_approved_version_id or status in ('DRAFT', 'PENDING', 'RETURNED'));
    if sv.id is null then
      raise exception 'Only the approved or in-progress version can be copied' using errcode = '23514';
    end if;
  end if;

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
      elsif private.recipe_covers_outlet(ing.prep_recipe_id, p_target_outlet_id) then
        -- Already a Prep of the target outlet: keep using it.
        v_prep := ing.prep_recipe_id;
      else
        v_sub := private.copy_recipe_tree(
          ing.prep_recipe_id, null, p_target_outlet_id, null, p_mapping, p_key, p_depth + 1, p_done);
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

create function public.copy_recipe(
  p_source_recipe_id uuid, p_target_outlet_id uuid, p_product_name text, p_prep_mapping jsonb,
  p_idempotency_key text, p_source_version_id uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
  -- A version still in progress is only for those who see the whole recipe, not Baristas.
  if p_source_version_id is not null and not private.can_see_recipe(p_source_recipe_id) then
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
    p_source_recipe_id, p_source_version_id, p_target_outlet_id, p_product_name,
    coalesce(p_prep_mapping, '{}'), p_idempotency_key, 1, '{}');

  return jsonb_build_object(
    'recipe_id', v_done ->> p_source_recipe_id::text,
    'version_id', (select id from public.recipe_versions
                    where recipe_id = (v_done ->> p_source_recipe_id::text)::uuid and version_no = 1),
    'copied', v_done);
end;
$function$;

revoke execute on function public.copy_recipe(uuid, uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function public.copy_recipe(uuid, uuid, text, jsonb, text, uuid) to authenticated;
