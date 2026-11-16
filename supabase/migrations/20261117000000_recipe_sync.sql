-- Same-name recipe sync (Nelson, 2026-11-17). Super Admin only.
--   * Super Admin picks two or more active recipes whose approved versions have the same name
--     (case and spacing ignored, drinks and Preps not mixed), compares them, and writes one
--     unified content (usually from AI, edited by him).
--   * sync_recipes overwrites every picked recipe with that content at once as a new APPROVED
--     version, no approval step. Each recipe keeps its own outlets, name, photos, introduction,
--     tags, taste, notes and packaging; the synced parts are the ingredients, the steps and the
--     main settings (style, temperature, yield, cup type, serving size, garnish).
--   * Old versions stay in the history (SUPERSEDED) and can be put back with Undo approval.
--   * A recipe with a draft / pending / returned version cannot be synced until that is handled.
--   * Everything is one transaction: if one recipe fails (e.g. incomplete cost, a Prep that does
--     not cover its outlets), nothing is changed.

create function private.recipe_name_key(p text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(p), '\s+', ' ', 'g'));
$$;

create function public.sync_recipes(p_recipe_ids uuid[], p_content jsonb) returns jsonb
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
begin
  perform private.require_admin();  -- Super Admin only since 20261116170000

  if coalesce(cardinality(p_recipe_ids), 0) < 2
     or cardinality(p_recipe_ids) <> (select count(distinct x) from unnest(p_recipe_ids) as x) then
    raise exception 'SYNC_NEED_TWO' using errcode = '23514';
  end if;

  -- Every recipe: active, approved, same name and same kind (drink / Prep).
  select count(distinct (private.recipe_name_key(v.product_name), r.is_prep))
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

    -- Step photos / videos belong to the old wording, so synced steps have none.
    delete from public.recipe_steps where recipe_version_id = v_version;
    insert into public.recipe_steps (recipe_version_id, step_no, instruction)
    select v_version, row_number() over (order by s.ord), btrim(s.x ->> 'instruction')
      from jsonb_array_elements(coalesce(p_content -> 'steps', '[]')) with ordinality as s (x, ord)
     where char_length(btrim(coalesce(s.x ->> 'instruction', ''))) > 0;

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

revoke execute on function public.sync_recipes(uuid[], jsonb) from public, anon;
grant execute on function public.sync_recipes(uuid[], jsonb) to authenticated;
