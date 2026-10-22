-- Recipe workflow: create, save draft, new version, submit, withdraw, return,
-- approve and cross-outlet copy, plus the recipe photo bucket.
-- Spec: design plan V0.2 ch. 8-11, 20; decisions D05-D08, D12, O05-O07, O09, O14.
-- Drink cost comes from public.calculate_recipe_cost (raw-material track).

-- Helpers ----------------------------------------------------------------

-- True when the version's Prep dependencies lead back to its own recipe.
-- Follows each Prep recipe's current approved version, as approval would (ch. 11).
create function private.recipe_has_cycle(p_version_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with recursive deps (recipe_id, path, depth) as (
    select ri.prep_recipe_id, array[v.recipe_id, ri.prep_recipe_id], 1
      from public.recipe_versions v
      join public.recipe_ingredients ri on ri.recipe_version_id = v.id
     where v.id = p_version_id and ri.prep_recipe_id is not null
    union all
    select ri.prep_recipe_id, d.path || ri.prep_recipe_id, d.depth + 1
      from deps d
      join public.recipes r on r.id = d.recipe_id
      join public.recipe_ingredients ri on ri.recipe_version_id = r.current_approved_version_id
     where ri.prep_recipe_id is not null
       and not ri.prep_recipe_id = any (d.path[2:])
       and d.depth < 10
  )
  select exists (
    select 1 from deps d
      join public.recipe_versions v on v.id = p_version_id
     where d.recipe_id = v.recipe_id
  );
$$;

-- Required-field check for submission (D12, O05). Returns [] when complete,
-- otherwise [{code, field, line}] so the editor can jump to each problem.
create function private.validate_recipe_version(p_version_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
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
$$;

-- Create and edit drafts (run as the caller, so RLS decides) -------------

create function public.create_recipe(
  p_outlet_id uuid,
  p_is_prep boolean,
  p_product_name text
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  -- Ids are made here: RETURNING would need the new row to pass the select
  -- policy, which cannot see rows inserted by the same statement.
  v_recipe_id uuid := gen_random_uuid();
  v_version_id uuid := gen_random_uuid();
begin
  insert into public.recipes (id, outlet_id, is_prep)
  values (v_recipe_id, p_outlet_id, p_is_prep);

  insert into public.recipe_versions (id, recipe_id, version_no, product_name, style)
  values (
    v_version_id, v_recipe_id, 1, nullif(btrim(p_product_name), ''),
    case when p_is_prep then 'PREP_MATERIAL'::public.beverage_style end
  );

  return v_version_id;
end;
$$;

-- Saves the whole draft in one transaction. p_revision is the revision the
-- editor loaded; a mismatch means someone else saved first (ch. 9.1).
create function public.save_recipe_draft(
  p_version_id uuid,
  p_revision integer,
  p_draft jsonb
) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_revision integer;
begin
  update public.recipe_versions set
    product_name = nullif(btrim(p_draft ->> 'product_name'), ''),
    purpose = coalesce((p_draft ->> 'purpose')::public.recipe_purpose, purpose),
    style = (p_draft ->> 'style')::public.beverage_style,
    temperature = (p_draft ->> 'temperature')::public.beverage_temp,
    yield_quantity = (p_draft ->> 'yield_quantity')::numeric,
    yield_unit = (p_draft ->> 'yield_unit')::public.measure_unit,
    appearance_notes = p_draft ->> 'appearance_notes',
    taste_sour = (p_draft ->> 'taste_sour')::smallint,
    taste_sweet = (p_draft ->> 'taste_sweet')::smallint,
    taste_bitter = (p_draft ->> 'taste_bitter')::smallint,
    taste_salty = (p_draft ->> 'taste_salty')::smallint,
    taste_umami = (p_draft ->> 'taste_umami')::smallint,
    taste_spicy = (p_draft ->> 'taste_spicy')::smallint,
    taste_smoky = (p_draft ->> 'taste_smoky')::smallint,
    taste_zesty = (p_draft ->> 'taste_zesty')::smallint,
    taste_funky = (p_draft ->> 'taste_funky')::smallint,
    taste_earthy = (p_draft ->> 'taste_earthy')::smallint,
    taste_oily = (p_draft ->> 'taste_oily')::smallint,
    cup_type = p_draft ->> 'cup_type',
    serving_size = p_draft ->> 'serving_size',
    garnish = p_draft ->> 'garnish',
    storage_method = p_draft ->> 'storage_method',
    shelf_life = p_draft ->> 'shelf_life',
    tasting_notes = p_draft ->> 'tasting_notes',
    change_summary = p_draft ->> 'change_summary'
  where id = p_version_id and revision = p_revision
  returning revision into v_revision;

  if v_revision is null then
    if exists (select 1 from public.recipe_versions where id = p_version_id and private.can_edit_recipe_version(id)) then
      raise exception 'Someone else saved this draft; reload to see their changes' using errcode = '40001';
    end if;
    raise exception 'This version is not an editable draft' using errcode = '42501';
  end if;

  delete from public.recipe_ingredients where recipe_version_id = p_version_id;
  insert into public.recipe_ingredients (recipe_version_id, sort_order, material_id, prep_recipe_id, quantity, unit, notes)
  select p_version_id, i.ord, (i.x ->> 'material_id')::uuid, (i.x ->> 'prep_recipe_id')::uuid,
         (i.x ->> 'quantity')::numeric, (i.x ->> 'unit')::public.measure_unit, i.x ->> 'notes'
    from jsonb_array_elements(coalesce(p_draft -> 'ingredients', '[]')) with ordinality as i (x, ord);

  delete from public.recipe_packaging where recipe_version_id = p_version_id;
  insert into public.recipe_packaging (recipe_version_id, sort_order, packaging_item_id, pieces)
  select p_version_id, i.ord, (i.x ->> 'packaging_item_id')::uuid, (i.x ->> 'pieces')::numeric
    from jsonb_array_elements(coalesce(p_draft -> 'packaging', '[]')) with ordinality as i (x, ord);

  delete from public.recipe_steps where recipe_version_id = p_version_id;
  insert into public.recipe_steps (recipe_version_id, step_no, instruction, media_asset_id)
  select p_version_id, i.ord, coalesce(i.x ->> 'instruction', ''), (i.x ->> 'media_asset_id')::uuid
    from jsonb_array_elements(coalesce(p_draft -> 'steps', '[]')) with ordinality as i (x, ord);

  delete from public.recipe_media where recipe_version_id = p_version_id;
  insert into public.recipe_media (recipe_version_id, sort_order, media_asset_id)
  select p_version_id, i.ord, (i.x #>> '{}')::uuid
    from jsonb_array_elements(coalesce(p_draft -> 'photos', '[]')) with ordinality as i (x, ord);

  return v_revision;
end;
$$;

-- Approved content is never edited; changes start a new draft from it (ch. 9.3).
create function public.create_recipe_version(p_recipe_id uuid) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_from uuid;
  v_new uuid := gen_random_uuid();
begin
  select current_approved_version_id into v_from from public.recipes where id = p_recipe_id;
  if v_from is null then
    raise exception 'This recipe has no approved version yet' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.recipe_versions
     where recipe_id = p_recipe_id and status in ('DRAFT', 'PENDING', 'RETURNED')
  ) then
    raise exception 'This recipe already has an open version' using errcode = '23505';
  end if;

  insert into public.recipe_versions (
    id, recipe_id, version_no, product_name, purpose, style, temperature, yield_quantity, yield_unit,
    appearance_notes, taste_sour, taste_sweet, taste_bitter, taste_salty, taste_umami, taste_spicy,
    taste_smoky, taste_zesty, taste_funky, taste_earthy, taste_oily, cup_type, serving_size,
    garnish, storage_method, shelf_life, tasting_notes, based_on_version_id)
  select v_new, recipe_id, (select max(version_no) + 1 from public.recipe_versions where recipe_id = p_recipe_id),
         product_name, purpose, style, temperature, yield_quantity, yield_unit,
         appearance_notes, taste_sour, taste_sweet, taste_bitter, taste_salty, taste_umami, taste_spicy,
         taste_smoky, taste_zesty, taste_funky, taste_earthy, taste_oily, cup_type, serving_size,
         garnish, storage_method, shelf_life, tasting_notes, id
    from public.recipe_versions where id = v_from;

  insert into public.recipe_ingredients (recipe_version_id, sort_order, material_id, prep_recipe_id, quantity, unit, notes)
  select v_new, sort_order, material_id, prep_recipe_id, quantity, unit, notes
    from public.recipe_ingredients where recipe_version_id = v_from;
  insert into public.recipe_packaging (recipe_version_id, sort_order, packaging_item_id, pieces)
  select v_new, sort_order, packaging_item_id, pieces
    from public.recipe_packaging where recipe_version_id = v_from;
  insert into public.recipe_steps (recipe_version_id, step_no, instruction, media_asset_id)
  select v_new, step_no, instruction, media_asset_id
    from public.recipe_steps where recipe_version_id = v_from;
  insert into public.recipe_media (recipe_version_id, sort_order, media_asset_id)
  select v_new, sort_order, media_asset_id
    from public.recipe_media where recipe_version_id = v_from;

  return v_new;
end;
$$;

-- Status changes (SECURITY DEFINER: the status guards only let these through) --

-- Returns {"errors": [...]} without changing anything when fields are missing.
create function public.submit_recipe_version(p_version_id uuid, p_revision integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.recipe_versions;
  v_outlet uuid;
  v_errors jsonb;
begin
  select * into v from public.recipe_versions where id = p_version_id for update;
  select outlet_id into v_outlet from public.recipes where id = v.recipe_id;
  if v.id is null or not private.can_manage_outlet(v_outlet) then
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
$$;

-- The submitter takes a pending version back to edit it.
create function public.withdraw_recipe_version(p_version_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.recipe_versions;
  v_outlet uuid;
begin
  select * into v from public.recipe_versions where id = p_version_id for update;
  select outlet_id into v_outlet from public.recipes where id = v.recipe_id;
  if v.id is null or v.submitted_by is distinct from auth.uid() or not private.can_manage_outlet(v_outlet) then
    raise exception 'Only the person who submitted can withdraw' using errcode = '42501';
  end if;
  if v.status <> 'PENDING' then
    raise exception 'Only a pending version can be withdrawn' using errcode = '23514';
  end if;

  update public.recipe_versions set status = 'DRAFT', updated_by = auth.uid() where id = p_version_id;
  insert into public.approval_events (entity_type, entity_id, outlet_id, action, actor_id)
  values ('RECIPE_VERSION', p_version_id, v_outlet, 'WITHDRAW', auth.uid());
end;
$$;

create function public.return_recipe_version(p_version_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.recipe_versions;
  v_outlet uuid;
begin
  if not private.is_admin() then
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
$$;

-- Writes cost lines (and Prep children) from calculate_recipe_cost output.
create function private.insert_cost_lines(p_snapshot_id uuid, p_parent_id uuid, p_lines jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  l jsonb;
  v_id uuid;
begin
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    insert into public.cost_snapshot_lines (
      snapshot_id, parent_line_id, line_type, display_name, material_id, pack_id, price_version_id,
      prep_recipe_version_id, packaging_item_id, packaging_price_id, quantity, unit, unit_cost, line_cost)
    values (
      p_snapshot_id, p_parent_id, l ->> 'line_type', coalesce(l ->> 'display_name', ''),
      (l ->> 'material_id')::uuid, (l ->> 'pack_id')::uuid, (l ->> 'price_version_id')::uuid,
      (l ->> 'prep_recipe_version_id')::uuid, (l ->> 'packaging_item_id')::uuid,
      (l ->> 'packaging_price_id')::uuid, (l ->> 'quantity')::numeric, l ->> 'unit',
      (l ->> 'unit_cost')::numeric, (l ->> 'line_cost')::numeric)
    returning id into v_id;
    perform private.insert_cost_lines(p_snapshot_id, v_id, l -> 'children');
  end loop;
end;
$$;

-- Approve: in one transaction re-check fields, dependencies and full cost (O09),
-- move the approved pointer, supersede the old version, snapshot the cost and log
-- the automatic switch on published menus (D08). Repeating the same
-- idempotency key returns the first result instead of approving twice.
create function public.approve_recipe_version(p_version_id uuid, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.recipe_versions;
  r public.recipes;
  v_errors jsonb;
  v_cost jsonb;
  v_snapshot uuid;
begin
  if not private.is_admin() then
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
$$;

-- Cross-outlet copy (D06, D07, O07) --------------------------------------

-- Copies one recipe's current approved version into the target outlet as a new
-- DRAFT V1. Prep dependencies use p_mapping ({source prep id: target prep id})
-- or are copied too, each only once (tracked in p_done).
create function private.copy_recipe_tree(
  p_source_recipe_id uuid,
  p_target_outlet_id uuid,
  p_product_name text,
  p_mapping jsonb,
  p_key text,
  p_depth integer,
  inout p_done jsonb
)
language plpgsql set search_path = '' as $$
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
           where id = v_prep and is_prep and outlet_id = p_target_outlet_id and status = 'ACTIVE'
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
$$;

-- Returns {"recipe_id", "version_id", "copied": {source recipe id: new recipe id}}.
create function public.copy_recipe(
  p_source_recipe_id uuid,
  p_target_outlet_id uuid,
  p_product_name text,
  p_prep_mapping jsonb,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_done jsonb;
  v_prov public.recipe_copy_provenance;
begin
  if not private.can_manage_outlet(p_target_outlet_id) then
    raise exception 'You can only copy into an outlet you manage' using errcode = '42501';
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
$$;

revoke execute on function
  public.create_recipe(uuid, boolean, text),
  public.save_recipe_draft(uuid, integer, jsonb),
  public.create_recipe_version(uuid),
  public.submit_recipe_version(uuid, integer),
  public.withdraw_recipe_version(uuid),
  public.return_recipe_version(uuid, text),
  public.approve_recipe_version(uuid, text),
  public.copy_recipe(uuid, uuid, text, jsonb, text)
from public, anon;
grant execute on function
  public.create_recipe(uuid, boolean, text),
  public.save_recipe_draft(uuid, integer, jsonb),
  public.create_recipe_version(uuid),
  public.submit_recipe_version(uuid, integer),
  public.withdraw_recipe_version(uuid),
  public.return_recipe_version(uuid, text),
  public.approve_recipe_version(uuid, text),
  public.copy_recipe(uuid, uuid, text, jsonb, text)
to authenticated;

-- Recipe photos (O14) ----------------------------------------------------
-- Private bucket; files live under <outlet id>/ and are readable by whoever
-- can see a recipe version that uses them (private.can_view_media).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-media', 'recipe-media', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create function private.can_upload_recipe_media(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_outlet uuid;
begin
  begin
    v_outlet := split_part(p_name, '/', 1)::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return private.can_manage_outlet(v_outlet);
end;
$$;
grant execute on function private.can_upload_recipe_media(text) to authenticated;

create policy recipe_media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-media' and private.can_upload_recipe_media(name));

create policy recipe_media_read on storage.objects for select to authenticated
  using (
    bucket_id = 'recipe-media'
    and (
      owner_id = auth.uid()::text
      or exists (
        select 1 from public.media_assets ma
         where ma.bucket = 'recipe-media' and ma.object_path = name and private.can_view_media(ma.id))
    )
  );
