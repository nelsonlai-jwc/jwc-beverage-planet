-- Managers of an outlet co-edit the recipe drafts of that outlet.
-- Decided with Nelson 2026-11-02:
--   * A draft or returned version can be edited and submitted by any Manager who manages
--     at least one of the recipe's outlets (before: every outlet). Admin approval is unchanged.
--   * All-outlet recipes: still only an Admin.
--   * Two people saving the same draft: the existing revision check refuses the later save.
--   * Withdraw stays with the person who submitted. Deleting a draft or the recipe,
--     starting a new version and changing outlets keep private.can_manage_recipe.

-- Admin, or a Manager of at least one of the recipe's outlets (never an all-outlet recipe).
create function private.can_edit_recipe_draft(p_recipe_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin() or (
    private.is_manager() and exists (
      select 1 from public.recipes r
       where r.id = p_recipe_id
         and not r.all_outlets
         and exists (
               select 1 from public.recipe_outlets ro
                 join public.user_outlets uo on uo.outlet_id = ro.outlet_id and uo.user_id = auth.uid()
                where ro.recipe_id = r.id)
    )
  );
$$;
revoke execute on function private.can_edit_recipe_draft(uuid) from public, anon;
grant execute on function private.can_edit_recipe_draft(uuid) to authenticated;

create or replace function private.can_edit_recipe_version(p_version_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.recipe_versions v
     where v.id = p_version_id
       and v.status in ('DRAFT', 'RETURNED')
       and private.can_edit_recipe_draft(v.recipe_id)
  );
$$;

drop policy recipe_versions_update on public.recipe_versions;
create policy recipe_versions_update on public.recipe_versions for update to authenticated
  using (private.can_edit_recipe_version(id))
  with check (private.can_edit_recipe_draft(recipe_id));

-- Deleting a draft stays with Managers of every outlet (and Admins).
drop policy recipe_versions_delete_draft on public.recipe_versions;
create policy recipe_versions_delete_draft on public.recipe_versions for delete to authenticated
  using (status = 'DRAFT' and private.can_edit_recipe_version(id) and private.can_manage_recipe(recipe_id));

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
  if v.id is null or not private.can_edit_recipe_draft(v.recipe_id) then
    raise exception 'You cannot submit this recipe' using errcode = '42501';
  end if;
  if v.status not in ('DRAFT', 'RETURNED') then
    raise exception 'Only a draft or returned version can be submitted' using errcode = '23514';
  end if;
  if v.revision <> p_revision then
    raise exception 'Someone else saved this draft; reload to see their changes' using errcode = 'PT409';
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
  if v.id is null or v.submitted_by is distinct from auth.uid() or not private.can_edit_recipe_draft(v.recipe_id) then
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

-- The editor shows the draft's live cost to everyone who may edit the draft.
-- Approved versions keep the old rule (Admin, or a Manager of the recipe's first outlet).
create or replace function public.calculate_recipe_cost(p_version_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_recipe public.recipes;
begin
  select r.* into v_recipe
    from public.recipe_versions v join public.recipes r on r.id = v.recipe_id
   where v.id = p_version_id;
  if not found or not (private.can_manage_outlet(v_recipe.outlet_id)
                       or private.can_edit_recipe_version(p_version_id)) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'recipe_version_id', p_version_id,
    'currency', 'MYR',
    'calculated_at', now())
    || private.recipe_cost_tree(p_version_id, array[v_recipe.id]);
end;
$$;

-- Co-editors see the submit/return history (and return reason) of the recipes they edit.
create function private.can_edit_recipe_of_version(p_version_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.recipe_versions v
     where v.id = p_version_id and private.can_edit_recipe_draft(v.recipe_id)
  );
$$;
revoke execute on function private.can_edit_recipe_of_version(uuid) from public, anon;
grant execute on function private.can_edit_recipe_of_version(uuid) to authenticated;

drop policy approval_events_select on public.approval_events;
create policy approval_events_select on public.approval_events for select to authenticated
  using (private.is_admin()
         or (private.is_manager() and (outlet_id is null or private.can_manage_outlet(outlet_id)))
         or (entity_type = 'RECIPE_VERSION' and private.can_edit_recipe_of_version(entity_id)));

-- A refused save or submit (someone else saved first) answers HTTP 409 (PT409). With
-- 40001 (serialization_failure) PostgREST retried the call forever and the editor
-- stayed on "Saving…".
-- Saves the whole draft in one transaction. p_revision is the revision the
-- editor loaded; a mismatch means someone else saved first (ch. 9.1).
create or replace function public.save_recipe_draft(
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
      raise exception 'Someone else saved this draft; reload to see their changes' using errcode = 'PT409';
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
