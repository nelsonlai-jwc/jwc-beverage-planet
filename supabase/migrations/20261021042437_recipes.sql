-- Recipes, versions, ingredients, steps, media and copy provenance.
-- Spec: design plan V0.2 ch. 8-11, 22; decisions D05-D08, D11, D12, O05-O07, O14, O17.

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete restrict,
  -- Prep Material recipes (style PREP_MATERIAL) can be used as ingredients in the same outlet.
  is_prep boolean not null default false,
  current_approved_version_id uuid,
  status public.record_status not null default 'ACTIVE',
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1
);
create index recipes_outlet_idx on public.recipes (outlet_id);

create trigger recipes_touch before update on public.recipes
  for each row execute function private.touch_row();

-- Outlet, type and the approved pointer change only inside business functions.
create function private.recipes_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.outlet_id <> old.outlet_id or new.is_prep <> old.is_prep then
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
create trigger recipes_guard before update on public.recipes
  for each row execute function private.recipes_guard();

create table public.recipe_versions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  version_no integer not null check (version_no > 0),
  status public.approval_status not null default 'DRAFT',
  -- Drafts may be incomplete (D12); submission checks required fields.
  product_name text check (product_name is null or char_length(btrim(product_name)) between 1 and 80),
  purpose public.recipe_purpose not null default 'RND',
  style public.beverage_style,
  temperature public.beverage_temp,
  yield_quantity numeric(18, 6) check (yield_quantity > 0),
  yield_unit public.measure_unit,
  appearance_notes text,
  -- Flavour 0-5; null means not assessed (ch. 8.1).
  taste_sour smallint check (taste_sour between 0 and 5),
  taste_sweet smallint check (taste_sweet between 0 and 5),
  taste_bitter smallint check (taste_bitter between 0 and 5),
  taste_salty smallint check (taste_salty between 0 and 5),
  taste_umami smallint check (taste_umami between 0 and 5),
  taste_spicy smallint check (taste_spicy between 0 and 5),
  taste_smoky smallint check (taste_smoky between 0 and 5),
  taste_zesty smallint check (taste_zesty between 0 and 5),
  taste_funky smallint check (taste_funky between 0 and 5),
  taste_earthy smallint check (taste_earthy between 0 and 5),
  taste_oily smallint check (taste_oily between 0 and 5),
  cup_type text,
  serving_size text,
  garnish text,
  storage_method text,
  shelf_life text,
  tasting_notes text,
  change_summary text,
  based_on_version_id uuid references public.recipe_versions (id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  updated_by uuid references public.profiles (id) on delete restrict,
  submitted_by uuid references public.profiles (id) on delete restrict,
  submitted_at timestamptz,
  approved_by uuid references public.profiles (id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  unique (recipe_id, version_no),
  unique (id, recipe_id),
  check ((yield_quantity is null) = (yield_unit is null))
);
-- One open change per recipe so two pending versions cannot overwrite each other (ch. 9.1).
create unique index recipe_versions_one_open
  on public.recipe_versions (recipe_id) where status in ('DRAFT', 'PENDING', 'RETURNED');

alter table public.recipes
  add constraint recipes_current_version_fk
  foreign key (current_approved_version_id, id) references public.recipe_versions (id, recipe_id)
  deferrable initially deferred;

create trigger recipe_versions_touch before update on public.recipe_versions
  for each row execute function private.touch_row();
create trigger recipe_versions_status_guard before insert or update on public.recipe_versions
  for each row execute function private.status_guard();

-- Submitted versions are immutable; style must match the recipe type; yield only for Prep.
create function private.recipe_versions_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_is_prep boolean;
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
  select is_prep into v_is_prep from public.recipes where id = new.recipe_id;
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
create trigger recipe_versions_guard before insert or update on public.recipe_versions
  for each row execute function private.recipe_versions_guard();

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_version_id uuid not null references public.recipe_versions (id) on delete cascade,
  sort_order integer not null check (sort_order > 0),
  material_id uuid references public.materials (id) on delete restrict,
  prep_recipe_id uuid references public.recipes (id) on delete restrict,
  quantity numeric(18, 6) check (quantity > 0),
  unit public.measure_unit,
  notes text,
  -- Exactly one of a shared material or an own-outlet Prep recipe (ch. 22).
  check (num_nonnulls(material_id, prep_recipe_id) = 1),
  unique (recipe_version_id, sort_order) deferrable initially deferred
);
create index recipe_ingredients_material_idx on public.recipe_ingredients (material_id);
create index recipe_ingredients_prep_idx on public.recipe_ingredients (prep_recipe_id);

create function private.recipe_ingredients_guard() returns trigger
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
  if v_prep.outlet_id <> v_parent.outlet_id then
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
create trigger recipe_ingredients_guard before insert or update on public.recipe_ingredients
  for each row execute function private.recipe_ingredients_guard();

create table public.recipe_packaging (
  id uuid primary key default gen_random_uuid(),
  recipe_version_id uuid not null references public.recipe_versions (id) on delete cascade,
  packaging_item_id uuid not null references public.packaging_items (id) on delete restrict,
  pieces numeric(10, 3) not null check (pieces > 0),
  sort_order integer not null check (sort_order > 0),
  unique (recipe_version_id, sort_order) deferrable initially deferred
);

create table public.recipe_steps (
  id uuid primary key default gen_random_uuid(),
  recipe_version_id uuid not null references public.recipe_versions (id) on delete cascade,
  step_no integer not null check (step_no > 0),
  instruction text not null default '',
  media_asset_id uuid references public.media_assets (id) on delete restrict,
  unique (recipe_version_id, step_no) deferrable initially deferred
);

create table public.recipe_media (
  id uuid primary key default gen_random_uuid(),
  recipe_version_id uuid not null references public.recipe_versions (id) on delete cascade,
  media_asset_id uuid not null references public.media_assets (id) on delete restrict,
  sort_order integer not null check (sort_order > 0),
  unique (recipe_version_id, sort_order) deferrable initially deferred,
  unique (recipe_version_id, media_asset_id)
);

-- At most 5 appearance photos per version (O14).
create function private.recipe_media_limit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.recipe_media where recipe_version_id = new.recipe_version_id) > 5 then
    raise exception 'A recipe version can have at most 5 appearance photos' using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger recipe_media_limit
  after insert or update on public.recipe_media
  deferrable initially deferred
  for each row execute function private.recipe_media_limit();

-- Copies are independent drafts; this only records where they came from (D07, ch. 10).
create table public.recipe_copy_provenance (
  id uuid primary key default gen_random_uuid(),
  target_recipe_id uuid not null unique references public.recipes (id) on delete cascade,
  target_version_id uuid not null references public.recipe_versions (id) on delete cascade,
  source_recipe_id uuid not null references public.recipes (id) on delete restrict,
  source_version_id uuid not null references public.recipe_versions (id) on delete restrict,
  source_outlet_id uuid not null references public.outlets (id) on delete restrict,
  copied_by uuid not null references public.profiles (id) on delete restrict,
  copied_at timestamptz not null default now(),
  idempotency_key text unique
);

-- Visibility -------------------------------------------------------------

-- Recipes a Barista may read: items on published menus of their outlet plus
-- their approved Prep dependencies, recursively (ch. 5, 12.3). plpgsql so the
-- menus tables (next migration) need not exist yet.
create function private.barista_visible_recipe_ids() returns setof uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.current_user_role() is distinct from 'BARISTA' then
    return;
  end if;
  return query
  with recursive visible (recipe_id) as (
    select mi.recipe_id
      from public.menu_items mi
      join public.menus m on m.id = mi.menu_id
      join public.user_outlets uo on uo.outlet_id = m.outlet_id and uo.user_id = auth.uid()
     where m.status = 'PUBLISHED'
    union
    select ri.prep_recipe_id
      from visible v
      join public.recipes r on r.id = v.recipe_id
      join public.recipe_ingredients ri on ri.recipe_version_id = r.current_approved_version_id
     where ri.prep_recipe_id is not null
  )
  select v.recipe_id
    from visible v
    join public.recipes r on r.id = v.recipe_id
   where r.current_approved_version_id is not null;
end;
$$;

create function private.can_view_recipe(p_recipe_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.recipes r
     where r.id = p_recipe_id
       and (
         private.can_manage_outlet(r.outlet_id)
         -- Cross-outlet approved catalogue for Managers (D06, O06).
         or (private.is_manager() and r.current_approved_version_id is not null and r.status = 'ACTIVE')
         or r.id in (select private.barista_visible_recipe_ids())
       )
  );
$$;

create function private.can_view_recipe_version(p_version_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.recipe_versions v
      join public.recipes r on r.id = v.recipe_id
     where v.id = p_version_id
       and (
         private.can_manage_outlet(r.outlet_id)
         or (v.id = r.current_approved_version_id and private.can_view_recipe(r.id))
       )
  );
$$;

create function private.can_edit_recipe_version(p_version_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.recipe_versions v
      join public.recipes r on r.id = v.recipe_id
     where v.id = p_version_id
       and v.status in ('DRAFT', 'RETURNED')
       and private.can_manage_outlet(r.outlet_id)
  );
$$;

create function private.can_view_media(p_media_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or exists (select 1 from public.media_assets m where m.id = p_media_id and m.created_by = auth.uid())
      or (private.is_manager() and exists (
            select 1 from public.materials mt where mt.photo_asset_id = p_media_id))
      or exists (
            select 1 from public.recipe_media rm
             where rm.media_asset_id = p_media_id and private.can_view_recipe_version(rm.recipe_version_id))
      or exists (
            select 1 from public.recipe_steps rs
             where rs.media_asset_id = p_media_id and private.can_view_recipe_version(rs.recipe_version_id));
$$;

grant execute on function private.barista_visible_recipe_ids() to authenticated;
grant execute on function private.can_view_recipe(uuid) to authenticated;
grant execute on function private.can_view_recipe_version(uuid) to authenticated;
grant execute on function private.can_edit_recipe_version(uuid) to authenticated;
grant execute on function private.can_view_media(uuid) to authenticated;

-- RLS --------------------------------------------------------------------

alter table public.recipes enable row level security;
alter table public.recipe_versions enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_packaging enable row level security;
alter table public.recipe_steps enable row level security;
alter table public.recipe_media enable row level security;
alter table public.recipe_copy_provenance enable row level security;

create policy recipes_select on public.recipes for select to authenticated
  using (private.can_view_recipe(id));
create policy recipes_insert on public.recipes for insert to authenticated
  with check (private.can_manage_outlet(outlet_id) and created_by = auth.uid()
              and current_approved_version_id is null and status = 'ACTIVE');
-- Drafts can be deleted; anything submitted or referenced is archived instead (D19).
create policy recipes_delete_draft on public.recipes for delete to authenticated
  using (private.can_manage_outlet(outlet_id)
         and current_approved_version_id is null
         and not exists (
           select 1 from public.recipe_versions v
            where v.recipe_id = recipes.id and v.status <> 'DRAFT'));

create policy recipe_versions_select on public.recipe_versions for select to authenticated
  using (private.can_view_recipe_version(id));
create policy recipe_versions_insert on public.recipe_versions for insert to authenticated
  with check (created_by = auth.uid() and exists (
    select 1 from public.recipes r
     where r.id = recipe_id and private.can_manage_outlet(r.outlet_id)));
create policy recipe_versions_update on public.recipe_versions for update to authenticated
  using (private.can_edit_recipe_version(id))
  with check (exists (
    select 1 from public.recipes r
     where r.id = recipe_id and private.can_manage_outlet(r.outlet_id)));
create policy recipe_versions_delete_draft on public.recipe_versions for delete to authenticated
  using (status = 'DRAFT' and private.can_edit_recipe_version(id));

create policy recipe_ingredients_select on public.recipe_ingredients for select to authenticated
  using (private.can_view_recipe_version(recipe_version_id));
create policy recipe_ingredients_insert on public.recipe_ingredients for insert to authenticated
  with check (private.can_edit_recipe_version(recipe_version_id));
create policy recipe_ingredients_update on public.recipe_ingredients for update to authenticated
  using (private.can_edit_recipe_version(recipe_version_id))
  with check (private.can_edit_recipe_version(recipe_version_id));
create policy recipe_ingredients_delete on public.recipe_ingredients for delete to authenticated
  using (private.can_edit_recipe_version(recipe_version_id));

create policy recipe_packaging_select on public.recipe_packaging for select to authenticated
  using (private.can_view_recipe_version(recipe_version_id));
create policy recipe_packaging_insert on public.recipe_packaging for insert to authenticated
  with check (private.can_edit_recipe_version(recipe_version_id));
create policy recipe_packaging_update on public.recipe_packaging for update to authenticated
  using (private.can_edit_recipe_version(recipe_version_id))
  with check (private.can_edit_recipe_version(recipe_version_id));
create policy recipe_packaging_delete on public.recipe_packaging for delete to authenticated
  using (private.can_edit_recipe_version(recipe_version_id));

create policy recipe_steps_select on public.recipe_steps for select to authenticated
  using (private.can_view_recipe_version(recipe_version_id));
create policy recipe_steps_insert on public.recipe_steps for insert to authenticated
  with check (private.can_edit_recipe_version(recipe_version_id));
create policy recipe_steps_update on public.recipe_steps for update to authenticated
  using (private.can_edit_recipe_version(recipe_version_id))
  with check (private.can_edit_recipe_version(recipe_version_id));
create policy recipe_steps_delete on public.recipe_steps for delete to authenticated
  using (private.can_edit_recipe_version(recipe_version_id));

create policy recipe_media_select on public.recipe_media for select to authenticated
  using (private.can_view_recipe_version(recipe_version_id));
create policy recipe_media_insert on public.recipe_media for insert to authenticated
  with check (private.can_edit_recipe_version(recipe_version_id));
create policy recipe_media_update on public.recipe_media for update to authenticated
  using (private.can_edit_recipe_version(recipe_version_id))
  with check (private.can_edit_recipe_version(recipe_version_id));
create policy recipe_media_delete on public.recipe_media for delete to authenticated
  using (private.can_edit_recipe_version(recipe_version_id));

create policy recipe_copy_provenance_select on public.recipe_copy_provenance for select to authenticated
  using (private.can_view_recipe(target_recipe_id));

create policy media_assets_select on public.media_assets for select to authenticated
  using (private.can_view_media(id));
create policy media_assets_insert on public.media_assets for insert to authenticated
  with check (private.is_admin_or_manager() and created_by = auth.uid()
              and (owner_outlet_id is null or private.can_manage_outlet(owner_outlet_id)));
create policy media_assets_update_own on public.media_assets for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());

-- Barista sees only material names used by their SOPs, plus coffee beans for calibration.
create policy materials_select_barista on public.materials for select to authenticated
  using (
    private.current_user_role() = 'BARISTA'
    and status = 'APPROVED'
    and (
      is_coffee_bean
      or exists (
        select 1
          from public.recipe_ingredients ri
          join public.recipes r on r.current_approved_version_id = ri.recipe_version_id
         where ri.material_id = materials.id
           and r.id in (select private.barista_visible_recipe_ids())
      )
    )
  );
