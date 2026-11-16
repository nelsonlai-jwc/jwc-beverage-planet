-- Beverage introduction and tags (Nelson, 2026-11-16).
--   * Every recipe version gets an optional introduction and a list of tags. Both are part of
--     the draft, so changes go through Admin approval like the other recipe fields.
--   * Each Manager / Admin keeps a personal tag history (like Google Maps labels) to pick
--     tags quickly next time. Only the owner sees it and can clear entries; clearing an entry
--     does not change any recipe.
--   * Introduction and tag names are AI translated like the other recipe texts.

create function private.valid_recipe_tags(p text[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(p) <= 20
     and not exists (select 1 from unnest(p) as t (v)
                      where v is null or v <> btrim(v) or char_length(v) not between 1 and 40);
$$;

alter table public.recipe_versions
  add column introduction text check (introduction is null or char_length(introduction) <= 2000),
  add column tags text[] not null default '{}' check (private.valid_recipe_tags(tags));

create table public.recipe_tag_history (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 40),
  last_used_at timestamptz not null default now(),
  primary key (user_id, name)
);

alter table public.recipe_tag_history enable row level security;
create policy recipe_tag_history_select on public.recipe_tag_history for select to authenticated
  using (user_id = auth.uid());
create policy recipe_tag_history_insert on public.recipe_tag_history for insert to authenticated
  with check (user_id = auth.uid() and private.current_user_role() in ('ADMIN', 'MANAGER'));
create policy recipe_tag_history_update on public.recipe_tag_history for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and private.current_user_role() in ('ADMIN', 'MANAGER'));
create policy recipe_tag_history_delete on public.recipe_tag_history for delete to authenticated
  using (user_id = auth.uid());
grant select, insert, update, delete on public.recipe_tag_history to authenticated;

-- Drafts save the introduction and tags.
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
    change_summary = p_draft ->> 'change_summary',
    -- Older editors send neither key; keep what is saved.
    introduction = case when p_draft ? 'introduction'
                        then nullif(btrim(p_draft ->> 'introduction'), '') else introduction end,
    tags = case when p_draft ? 'tags' then coalesce(array(
             select btrim(x.v) from jsonb_array_elements_text(p_draft -> 'tags') with ordinality as x (v, ord)
              where btrim(x.v) <> '' order by x.ord), '{}') else tags end
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

-- A new version starts with the approved version's introduction and tags.
create or replace function public.create_recipe_version(p_recipe_id uuid) returns uuid
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
    garnish, storage_method, shelf_life, tasting_notes, introduction, tags, based_on_version_id)
  select v_new, recipe_id, (select max(version_no) + 1 from public.recipe_versions where recipe_id = p_recipe_id),
         product_name, purpose, style, temperature, yield_quantity, yield_unit,
         appearance_notes, taste_sour, taste_sweet, taste_bitter, taste_salty, taste_umami, taste_spicy,
         taste_smoky, taste_zesty, taste_funky, taste_earthy, taste_oily, cup_type, serving_size,
         garnish, storage_method, shelf_life, tasting_notes, introduction, tags, id
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

-- Copies keep the introduction and tags.
create or replace function private.copy_recipe_tree(
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
    garnish, storage_method, shelf_life, tasting_notes, introduction, tags, updated_by)
  values (
    v_recipe, 1, coalesce(nullif(btrim(p_product_name), ''), sv.product_name), sv.purpose, sv.style,
    sv.temperature, sv.yield_quantity, sv.yield_unit, sv.appearance_notes, sv.taste_sour,
    sv.taste_sweet, sv.taste_bitter, sv.taste_salty, sv.taste_umami, sv.taste_spicy, sv.taste_smoky,
    sv.taste_zesty, sv.taste_funky, sv.taste_earthy, sv.taste_oily, sv.cup_type, sv.serving_size,
    sv.garnish, sv.storage_method, sv.shelf_life, sv.tasting_notes, sv.introduction, sv.tags, auth.uid())
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

-- Introduction and tag names can be translated.
create or replace function private.is_translatable_text(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.materials
                  where name = p or description = p or specification = p)
      or exists (select 1 from public.packaging_items where name = p or description = p)
      or exists (select 1 from public.recipe_versions
                  where product_name = p or garnish = p or tasting_notes = p or appearance_notes = p
                     or cup_type = p or serving_size = p or storage_method = p or shelf_life = p
                     or introduction = p or p = any (tags))
      or exists (select 1 from public.recipe_steps where instruction = p)
      or exists (select 1 from public.menus where name = p)
      or exists (select 1 from public.menu_categories where name = p);
$$;
