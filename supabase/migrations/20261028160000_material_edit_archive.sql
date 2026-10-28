-- Editing, deleting, archiving and importing shared materials and packaging.
-- Decided with Nelson 2026-10-28:
--   * Drafts and returned items: the creator (or an Admin) edits them in place.
--   * Approved items: an Admin's edit applies at once; a Manager's edit is a request
--     the Admin approves. The old values stay in the audit trail.
--   * "Delete": never-submitted drafts are really deleted; anything else is archived
--     (D19). Archiving an approved item is direct for an Admin and a request for a
--     Manager. Items used by a live recipe cannot be archived (ch. 7.4).
--   * An Admin can restore an archived item.

-- Only the creator or an Admin edits a draft ---------------------------------

alter policy materials_update on public.materials
  using (private.is_admin() or (private.is_admin_or_manager() and created_by = auth.uid()));
alter policy material_packs_update on public.material_packs
  using (status in ('DRAFT', 'RETURNED')
         and (private.is_admin() or (private.is_admin_or_manager() and created_by = auth.uid())));
alter policy material_price_versions_update on public.material_price_versions
  using (status in ('DRAFT', 'RETURNED')
         and (private.is_admin() or (private.is_admin_or_manager() and created_by = auth.uid())));
alter policy packaging_items_update on public.packaging_items
  using (status in ('DRAFT', 'RETURNED')
         and (private.is_admin() or (private.is_admin_or_manager() and created_by = auth.uid())));
alter policy packaging_prices_update on public.packaging_prices
  using (status in ('DRAFT', 'RETURNED')
         and (private.is_admin() or (private.is_admin_or_manager() and created_by = auth.uid())));

create function private.require_owner_or_admin(p_created_by uuid) returns void
language plpgsql stable set search_path = '' as $$
begin
  if not (private.is_admin() or (private.is_admin_or_manager() and p_created_by = auth.uid())) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
end;
$$;
grant execute on function private.require_owner_or_admin(uuid) to authenticated;

-- Submitting is part of editing a draft, so it follows the same owner rule.
create or replace function public.submit_material(p_material_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_material public.materials;
  v_first_pack uuid;
begin
  perform private.require_admin_or_manager();
  select * into v_material from public.materials where id = p_material_id for update;
  if not found or v_material.status not in ('DRAFT', 'RETURNED') then
    raise exception 'NOT_SUBMITTABLE' using errcode = '22023';
  end if;
  perform private.require_owner_or_admin(v_material.created_by);
  select id into v_first_pack from public.material_packs
   where material_id = p_material_id and status <> 'ARCHIVED'
   order by created_at limit 1;
  if v_first_pack is null then
    raise exception 'PACK_REQUIRED' using errcode = '22023';
  end if;

  update public.material_packs set status = 'PENDING'
   where material_id = p_material_id and status in ('DRAFT', 'RETURNED');
  update public.material_price_versions pv set status = 'PENDING'
    from public.material_packs p
   where p.id = pv.pack_id and p.material_id = p_material_id
     and pv.status in ('DRAFT', 'RETURNED');
  update public.materials
     set status = 'PENDING',
         cost_pack_id = coalesce(cost_pack_id, v_first_pack),
         updated_by = auth.uid()
   where id = p_material_id;
  perform private.log_approval('MATERIAL', p_material_id, 'SUBMIT');
end;
$$;

create or replace function public.submit_packaging_item(p_item_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.packaging_items;
begin
  perform private.require_admin_or_manager();
  select * into v_item from public.packaging_items where id = p_item_id for update;
  if not found or v_item.status not in ('DRAFT', 'RETURNED') then
    raise exception 'NOT_SUBMITTABLE' using errcode = '22023';
  end if;
  perform private.require_owner_or_admin(v_item.created_by);

  update public.packaging_prices set status = 'PENDING'
   where packaging_item_id = p_item_id and status in ('DRAFT', 'RETURNED');
  update public.packaging_items set status = 'PENDING' where id = p_item_id;
  perform private.log_approval('PACKAGING_ITEM', p_item_id, 'SUBMIT');
end;
$$;

-- Material photos live in the recipe-media bucket under materials/ ------------
-- Reading is already covered by recipe_media_read (private.can_view_media).

create policy material_media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'recipe-media' and name like 'materials/%' and private.is_admin_or_manager());

-- Change requests: edits and archiving of approved items ---------------------

create table public.change_requests (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('MATERIAL', 'PACKAGING_ITEM', 'RECIPE')),
  entity_id uuid not null,
  outlet_id uuid references public.outlets (id) on delete restrict,
  action text not null check (action in ('EDIT', 'ARCHIVE', 'RESTORE')),
  -- EDIT only: the proposed field values, and the values they replace.
  changes jsonb,
  old_values jsonb,
  reason text,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'RETURNED', 'WITHDRAWN')),
  requested_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  reviewed_by uuid references public.profiles (id) on delete restrict,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  check (action <> 'EDIT' or changes is not null),
  check (status <> 'RETURNED' or char_length(btrim(coalesce(review_reason, ''))) > 0)
);
create unique index change_requests_one_pending
  on public.change_requests (entity_type, entity_id) where status = 'PENDING';
create index change_requests_entity_idx on public.change_requests (entity_type, entity_id, created_at);

create trigger change_requests_touch before update on public.change_requests
  for each row execute function private.touch_row();
create trigger audit_change_requests after insert or update or delete on public.change_requests
  for each row execute function private.audit_row();

-- Written only by the functions below.
alter table public.change_requests enable row level security;
create policy change_requests_select on public.change_requests for select to authenticated
  using (private.is_admin()
         or (private.is_admin_or_manager() and entity_type in ('MATERIAL', 'PACKAGING_ITEM'))
         or (entity_type = 'RECIPE' and private.can_manage_outlet(outlet_id)));
revoke insert, update, delete on public.change_requests from anon, authenticated;

-- Fields an edit may change. Pack sizes, prices and the costing pack keep their own workflow.
create function private.editable_fields(p_entity_type text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_entity_type
    when 'MATERIAL' then array['name', 'brand', 'no_brand', 'specification', 'material_type_id',
                               'description', 'abv', 'bx', 'is_coffee_bean', 'photo_asset_id']
    when 'PACKAGING_ITEM' then array['name', 'brand', 'description']
    else array[]::text[] end;
$$;

create function private.entity_row(p_entity_type text, p_entity_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case p_entity_type
    when 'MATERIAL' then (select to_jsonb(m) from public.materials m where m.id = p_entity_id)
    when 'PACKAGING_ITEM' then (select to_jsonb(p) from public.packaging_items p where p.id = p_entity_id)
  end;
$$;

-- Applies an edit, archive or restore. Callers check permissions; this checks the rules.
create function private.apply_change(
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_changes jsonb
) returns void
language plpgsql set search_path = '' as $$
declare
  v_m public.materials;
  v_p public.packaging_items;
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

-- Edit or archive an approved (or returned) item. Returns 'APPLIED' when the change
-- took effect, 'REQUESTED' when it waits for an Admin.
create function public.request_change(
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
begin
  perform private.require_admin_or_manager();
  if p_entity_type not in ('MATERIAL', 'PACKAGING_ITEM') or p_action not in ('EDIT', 'ARCHIVE') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  v_row := private.entity_row(p_entity_type, p_entity_id);
  if v_row is null then
    raise exception 'NOT_FOUND' using errcode = '22023';
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

  -- Admins change anything directly; a creator archives their own returned item.
  v_direct := private.is_admin()
    or (p_action = 'ARCHIVE' and v_row ->> 'status' = 'RETURNED'
        and v_row ->> 'created_by' = auth.uid()::text);
  if not v_direct and v_row ->> 'status' = 'RETURNED' then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if v_direct then
    perform private.apply_change(p_entity_type, p_entity_id, p_action, v_changes);
    insert into public.change_requests
      (entity_type, entity_id, action, changes, old_values, reason, status, reviewed_by, reviewed_at)
    values
      (p_entity_type, p_entity_id, p_action, v_changes, v_old,
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
  insert into public.change_requests (entity_type, entity_id, action, changes, old_values, reason)
  values (p_entity_type, p_entity_id, p_action, v_changes, v_old, nullif(btrim(coalesce(p_reason, '')), ''));
  return 'REQUESTED';
end;
$$;

create function public.review_change_request(p_request_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_request public.change_requests;
begin
  perform private.require_admin();
  select * into v_request from public.change_requests where id = p_request_id for update;
  if not found or v_request.status <> 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;
  if p_approve then
    perform private.apply_change(v_request.entity_type, v_request.entity_id, v_request.action, v_request.changes);
    update public.change_requests
       set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now(),
           review_reason = nullif(btrim(coalesce(p_reason, '')), '')
     where id = p_request_id;
  else
    perform private.require_reason(p_reason);
    update public.change_requests
       set status = 'RETURNED', reviewed_by = auth.uid(), reviewed_at = now(), review_reason = btrim(p_reason)
     where id = p_request_id;
  end if;
end;
$$;

create function public.restore_archived(p_entity_type text, p_entity_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_entity_type not in ('MATERIAL', 'PACKAGING_ITEM') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  perform private.apply_change(p_entity_type, p_entity_id, 'RESTORE', null);
  insert into public.change_requests (entity_type, entity_id, action, status, reviewed_by, reviewed_at)
  values (p_entity_type, p_entity_id, 'RESTORE', 'APPROVED', auth.uid(), now());
end;
$$;

-- Deleting drafts that were never submitted -----------------------------------

create function public.delete_material_draft(p_material_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_material public.materials;
begin
  perform private.require_admin_or_manager();
  select * into v_material from public.materials where id = p_material_id for update;
  if not found or v_material.status <> 'DRAFT' then
    raise exception 'NOT_DELETABLE' using errcode = '22023';
  end if;
  perform private.require_owner_or_admin(v_material.created_by);
  if exists (select 1 from public.recipe_ingredients where material_id = p_material_id) then
    raise exception 'IN_USE' using errcode = '22023';
  end if;

  update public.materials set cost_pack_id = null where id = p_material_id;
  delete from public.material_price_versions pv
   using public.material_packs p
   where p.id = pv.pack_id and p.material_id = p_material_id;
  delete from public.material_conversions where material_id = p_material_id;
  delete from public.material_packs where material_id = p_material_id;
  delete from public.materials where id = p_material_id;
end;
$$;

create function public.delete_packaging_draft(p_item_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.packaging_items;
begin
  perform private.require_admin_or_manager();
  select * into v_item from public.packaging_items where id = p_item_id for update;
  if not found or v_item.status <> 'DRAFT' then
    raise exception 'NOT_DELETABLE' using errcode = '22023';
  end if;
  perform private.require_owner_or_admin(v_item.created_by);
  if exists (select 1 from public.recipe_packaging where packaging_item_id = p_item_id) then
    raise exception 'IN_USE' using errcode = '22023';
  end if;

  delete from public.packaging_prices where packaging_item_id = p_item_id;
  delete from public.packaging_items where id = p_item_id;
end;
$$;

-- Which recipes use an item ------------------------------------------------------
-- Live use: an active recipe's approved version uses it, directly or through Prep.
-- Draft use: an open (draft, pending or returned) version uses it directly.

create function public.item_usage(p_material_id uuid, p_packaging_item_id uuid)
returns table (
  recipe_id uuid,
  product_name text,
  outlet_name text,
  is_prep boolean,
  usage text,
  via_prep_name text
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
         pv.product_name
    from uses u
    join public.recipes r on r.id = u.recipe_id
    join public.outlets o on o.id = r.outlet_id
    left join public.recipe_versions av on av.id = r.current_approved_version_id
    left join lateral (
      select v.product_name from public.recipe_versions v
       where v.recipe_id = r.id order by v.version_no desc limit 1) lv on true
    left join public.recipes pr on pr.id = u.via_prep
    left join public.recipe_versions pv on pv.id = pr.current_approved_version_id
   order by u.usage desc, o.name, 2;
end;
$$;

-- Change log of one material or packaging item ------------------------------------
-- Raw audit rows of the item and its packs and prices, plus change requests and
-- approval events (for reasons). The page turns them into readable entries.

create function public.item_change_log(p_entity_type text, p_entity_id uuid)
returns table (
  happened_at timestamptz,
  actor_name text,
  source text,
  table_name text,
  record_id text,
  action text,
  old_values jsonb,
  new_values jsonb,
  reason text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin_or_manager();
  if p_entity_type not in ('MATERIAL', 'PACKAGING_ITEM') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return query
  with records (table_name, record_id) as (
    select case p_entity_type when 'MATERIAL' then 'materials' else 'packaging_items' end, p_entity_id::text
    union all
    select 'material_packs', p.id::text from public.material_packs p
     where p_entity_type = 'MATERIAL' and p.material_id = p_entity_id
    union all
    select 'material_price_versions', pv.id::text
      from public.material_price_versions pv join public.material_packs p on p.id = pv.pack_id
     where p_entity_type = 'MATERIAL' and p.material_id = p_entity_id
    union all
    select 'packaging_prices', pp.id::text from public.packaging_prices pp
     where p_entity_type = 'PACKAGING_ITEM' and pp.packaging_item_id = p_entity_id
  )
  select a.created_at, pr.full_name, 'AUDIT', a.table_name, a.record_id, a.action,
         a.old_values, a.new_values, null::text
    from public.audit_events a
    join records r on r.table_name = a.table_name and r.record_id = a.record_id
    left join public.profiles pr on pr.id = a.actor_id
  union all
  select c.created_at, pr.full_name, 'REQUEST', null, c.id::text, c.action || ':' || c.status,
         c.old_values, c.changes, c.reason
    from public.change_requests c
    left join public.profiles pr on pr.id = c.requested_by
   where c.entity_type = p_entity_type and c.entity_id = p_entity_id
  union all
  select c.reviewed_at, pr.full_name, 'REVIEW', null, c.id::text, c.action || ':' || c.status,
         null, null, c.review_reason
    from public.change_requests c
    left join public.profiles pr on pr.id = c.reviewed_by
   where c.entity_type = p_entity_type and c.entity_id = p_entity_id
     and c.status in ('APPROVED', 'RETURNED') and c.reviewed_by is distinct from c.requested_by
  union all
  select e.created_at, pr.full_name, 'APPROVAL', e.entity_type, e.entity_id::text, e.action,
         null, null, e.reason
    from public.approval_events e
    join records r on r.record_id = e.entity_id::text
     and e.entity_type = case r.table_name
       when 'materials' then 'MATERIAL' when 'material_packs' then 'MATERIAL_PACK'
       when 'material_price_versions' then 'MATERIAL_PRICE' when 'packaging_items' then 'PACKAGING_ITEM'
       when 'packaging_prices' then 'PACKAGING_PRICE' end
    left join public.profiles pr on pr.id = e.actor_id
   order by 1 desc;
end;
$$;

-- CSV import ---------------------------------------------------------------------
-- All rows in one transaction: one bad row and nothing is imported. The page checks
-- the file first and shows each row's problem. Runs as the caller, so RLS applies.
-- Managers create drafts; an Admin may approve them at once.

create function public.import_materials(p_rows jsonb, p_approve boolean default false) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  r jsonb;
  v_material_id uuid;
  v_pack_id uuid;
  v_count integer := 0;
begin
  perform private.require_admin_or_manager();
  if p_approve then
    perform private.require_admin();
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_material_id := gen_random_uuid();
    v_pack_id := gen_random_uuid();
    insert into public.materials
      (id, name, brand, no_brand, specification, material_type_id, description, abv, bx, is_coffee_bean)
    values (
      v_material_id, btrim(r ->> 'name'),
      case when (r ->> 'no_brand')::boolean then null else btrim(r ->> 'brand') end,
      (r ->> 'no_brand')::boolean,
      nullif(btrim(coalesce(r ->> 'specification', '')), ''),
      (r ->> 'material_type_id')::uuid,
      nullif(btrim(coalesce(r ->> 'description', '')), ''),
      (r ->> 'abv')::numeric, (r ->> 'bx')::numeric,
      coalesce((r ->> 'is_coffee_bean')::boolean, false));
    insert into public.material_packs (id, material_id, pack_quantity, unit, description)
    values (v_pack_id, v_material_id, (r ->> 'pack_quantity')::numeric, (r ->> 'unit')::public.measure_unit,
            nullif(btrim(coalesce(r ->> 'pack_description', '')), ''));
    update public.materials set cost_pack_id = v_pack_id where id = v_material_id;
    if r ->> 'price' is not null then
      insert into public.material_price_versions (pack_id, price, free_reason)
      values (v_pack_id, (r ->> 'price')::numeric, nullif(btrim(coalesce(r ->> 'free_reason', '')), ''));
    end if;
    if p_approve then
      perform public.submit_material(v_material_id);
      perform public.approve_material(v_material_id);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create function public.import_packaging_items(p_rows jsonb, p_approve boolean default false) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  r jsonb;
  v_item_id uuid;
  v_count integer := 0;
begin
  perform private.require_admin_or_manager();
  if p_approve then
    perform private.require_admin();
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_item_id := gen_random_uuid();
    insert into public.packaging_items (id, name, brand, description)
    values (v_item_id, btrim(r ->> 'name'),
            nullif(btrim(coalesce(r ->> 'brand', '')), ''),
            nullif(btrim(coalesce(r ->> 'description', '')), ''));
    if r ->> 'price' is not null then
      insert into public.packaging_prices (packaging_item_id, price_per_piece, free_reason)
      values (v_item_id, (r ->> 'price')::numeric, nullif(btrim(coalesce(r ->> 'free_reason', '')), ''));
    end if;
    if p_approve then
      perform public.submit_packaging_item(v_item_id);
      perform public.approve_packaging_item(v_item_id);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Grants -------------------------------------------------------------------------

revoke execute on function
  public.request_change(text, uuid, text, jsonb, text),
  public.review_change_request(uuid, boolean, text),
  public.restore_archived(text, uuid),
  public.delete_material_draft(uuid),
  public.delete_packaging_draft(uuid),
  public.item_usage(uuid, uuid),
  public.item_change_log(text, uuid),
  public.import_materials(jsonb, boolean),
  public.import_packaging_items(jsonb, boolean)
from public, anon;
grant execute on function
  public.request_change(text, uuid, text, jsonb, text),
  public.review_change_request(uuid, boolean, text),
  public.restore_archived(text, uuid),
  public.delete_material_draft(uuid),
  public.delete_packaging_draft(uuid),
  public.item_usage(uuid, uuid),
  public.item_change_log(text, uuid),
  public.import_materials(jsonb, boolean),
  public.import_packaging_items(jsonb, boolean)
to authenticated;
