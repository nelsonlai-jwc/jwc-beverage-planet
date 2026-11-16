-- Menu categories: one tree per outlet, shared by all of its menus.
-- Main categories have no parent; sub-categories can nest without limit.
-- Managed by the outlet's Managers and Admins (same as menus), no approval.
-- A menu drink may sit in any category, or in none ("Uncategorized").

create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete restrict,
  parent_id uuid references public.menu_categories (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1
);
create index menu_categories_outlet_idx on public.menu_categories (outlet_id);
create index menu_categories_parent_idx on public.menu_categories (parent_id);
-- No two categories with the same name under the same parent.
create unique index menu_categories_sibling_name_key
  on public.menu_categories (outlet_id, parent_id, lower(btrim(name))) nulls not distinct;

create trigger menu_categories_touch before update on public.menu_categories
  for each row execute function private.touch_row();

-- A sub-category stays in its parent's outlet; outlet and parent never change
-- (so the tree cannot form a loop).
create function private.menu_categories_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.outlet_id <> old.outlet_id or new.parent_id is distinct from old.parent_id then
      raise exception 'A category cannot move to another outlet or parent' using errcode = '23514';
    end if;
  elsif new.parent_id is not null and not exists (
    select 1 from public.menu_categories c where c.id = new.parent_id and c.outlet_id = new.outlet_id
  ) then
    raise exception 'A sub-category must be in the same outlet as its parent' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger menu_categories_guard before insert or update on public.menu_categories
  for each row execute function private.menu_categories_guard();

alter table public.menu_items
  add column category_id uuid references public.menu_categories (id) on delete set null;
alter table public.menu_revision_items
  add column category_id uuid references public.menu_categories (id) on delete set null;
create index menu_items_category_idx on public.menu_items (category_id);
create index menu_revision_items_category_idx on public.menu_revision_items (category_id);

-- A category can be deleted only when it has no sub-categories and no drink of
-- a menu that is not archived uses it. Archived menus just lose the category.
create function private.menu_categories_delete_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.menu_categories c where c.parent_id = old.id) then
    raise exception 'CATEGORY_HAS_CHILDREN' using errcode = '23503';
  end if;
  if exists (
       select 1 from public.menu_items mi join public.menus m on m.id = mi.menu_id
        where mi.category_id = old.id and m.status <> 'ARCHIVED')
     or exists (
       select 1 from public.menu_revision_items ri
         join public.menu_revisions mr on mr.id = ri.menu_revision_id
         join public.menus m on m.id = mr.menu_id
        where ri.category_id = old.id and m.status <> 'ARCHIVED') then
    raise exception 'CATEGORY_IN_USE' using errcode = '23503';
  end if;
  return old;
end;
$$;
create trigger menu_categories_delete_guard before delete on public.menu_categories
  for each row execute function private.menu_categories_delete_guard();

-- A drink's category must belong to the menu's outlet.
create function private.menu_item_category_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_menu_outlet uuid;
begin
  if new.category_id is null then
    return new;
  end if;
  if tg_table_name = 'menu_items' then
    select outlet_id into v_menu_outlet from public.menus where id = new.menu_id;
  else
    select m.outlet_id into v_menu_outlet
      from public.menu_revisions mr join public.menus m on m.id = mr.menu_id
     where mr.id = new.menu_revision_id;
  end if;
  if not exists (
    select 1 from public.menu_categories c where c.id = new.category_id and c.outlet_id = v_menu_outlet
  ) then
    raise exception 'The category belongs to another outlet' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger menu_items_category_guard before insert or update on public.menu_items
  for each row execute function private.menu_item_category_guard();
create trigger menu_revision_items_category_guard before insert or update on public.menu_revision_items
  for each row execute function private.menu_item_category_guard();

create trigger audit_menu_categories after insert or update or delete on public.menu_categories
  for each row execute function private.audit_row();

alter table public.menu_categories enable row level security;

-- Everyone of the outlet can read the names (staff see them on published menus).
create policy menu_categories_select on public.menu_categories for select to authenticated
  using (private.can_manage_outlet(outlet_id) or private.is_outlet_member(outlet_id));
create policy menu_categories_insert on public.menu_categories for insert to authenticated
  with check (private.can_manage_outlet(outlet_id) and created_by = auth.uid());
create policy menu_categories_update on public.menu_categories for update to authenticated
  using (private.can_manage_outlet(outlet_id)) with check (private.can_manage_outlet(outlet_id));
create policy menu_categories_delete on public.menu_categories for delete to authenticated
  using (private.can_manage_outlet(outlet_id));

-- Publish history and publish carry each drink's category.
create or replace function private.menu_items_snapshot(p_menu_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'recipe_id', mi.recipe_id,
           'recipe_version_id', r.current_approved_version_id,
           'product_name', v.product_name,
           'price', mi.price,
           'sort_order', mi.sort_order,
           'category_id', mi.category_id,
           'category_name', c.name
         ) order by mi.sort_order), '[]')
    from public.menu_items mi
    join public.recipes r on r.id = mi.recipe_id
    left join public.recipe_versions v on v.id = r.current_approved_version_id
    left join public.menu_categories c on c.id = mi.category_id
   where mi.menu_id = p_menu_id;
$$;

create or replace function public.publish_menu(p_menu_id uuid) returns void
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
  select ri.recipe_id, ri.price, ri.sort_order, ri.category_id
    from public.menu_revision_items ri
   where v_revision_id is not null and ri.menu_revision_id = v_revision_id
  union all
  select mi.recipe_id, mi.price, mi.sort_order, mi.category_id
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
    insert into public.menu_items (menu_id, recipe_id, price, sort_order, category_id)
    select p_menu_id, recipe_id, price, sort_order, category_id from menu_publish_source;
    delete from public.menu_revisions where id = v_revision_id;
  end if;

  update public.menus
     set status = 'PUBLISHED', published_at = now(), published_by = auth.uid()
   where id = p_menu_id;

  insert into public.menu_publish_history (menu_id, outlet_id, event, snapshot, actor_id)
  values (p_menu_id, v_menu.outlet_id, 'PUBLISH', private.menu_items_snapshot(p_menu_id), auth.uid());
end;
$$;
