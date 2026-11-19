-- Raw materials: "Used in Espresso calibration" / "Used in Filter calibration" replace the
-- single coffee-bean tick. Both can only be set on a material of type "Coffee Bean"; any
-- other type saves them as off. is_coffee_bean stays as "used in either", kept by the
-- trigger below, so the calibration tables' existing checks keep working.

alter table public.materials
  add column espresso_calibration boolean not null default false,
  add column filter_calibration boolean not null default false;

-- Beans already ticked keep working in both calibrations.
alter table public.materials disable trigger materials_edit_guard;
update public.materials set espresso_calibration = true, filter_calibration = true where is_coffee_bean;
alter table public.materials enable trigger materials_edit_guard;

-- The type is found by name, because material types have no fixed code.
create function private.is_coffee_bean_type(p_type_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.material_types
                  where id = p_type_id and lower(btrim(name)) = 'coffee bean');
$$;

create function private.materials_calibration_use() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not private.is_coffee_bean_type(new.material_type_id) then
    new.espresso_calibration := false;
    new.filter_calibration := false;
  end if;
  new.is_coffee_bean := new.espresso_calibration or new.filter_calibration;
  return new;
end;
$$;
create trigger materials_calibration_use before insert or update on public.materials
  for each row execute function private.materials_calibration_use();

CREATE OR REPLACE FUNCTION private.editable_fields(p_entity_type text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_entity_type
    when 'MATERIAL' then array['name', 'brand', 'no_brand', 'specification', 'material_type_id',
                               'description', 'abv', 'bx', 'espresso_calibration', 'filter_calibration',
                               'photo_asset_id']
    when 'PACKAGING_ITEM' then array['name', 'brand', 'description']
    else array[]::text[] end;
$function$

;

CREATE OR REPLACE FUNCTION private.apply_change(p_entity_type text, p_entity_id uuid, p_action text, p_changes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_m public.materials;
  v_p public.packaging_items;
  v_r public.recipes;
  v_blocker text;
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
             espresso_calibration = v_m.espresso_calibration, filter_calibration = v_m.filter_calibration,
             photo_asset_id = v_m.photo_asset_id,
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
  elsif p_entity_type = 'RECIPE' then
    -- Recipe edits are new versions; only archive and restore come through here.
    select * into v_r from public.recipes where id = p_entity_id for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = '22023';
    end if;
    if p_action = 'ARCHIVE' then
      if v_r.status <> 'ACTIVE' then
        raise exception 'NOT_ARCHIVABLE' using errcode = '22023';
      end if;
      v_blocker := private.recipe_archive_blocker(p_entity_id);
      if v_blocker is not null then
        raise exception '%', v_blocker using errcode = '22023';
      end if;
      update public.recipes set status = 'ARCHIVED' where id = p_entity_id;
    elsif p_action = 'RESTORE' then
      if v_r.status <> 'ARCHIVED' then
        raise exception 'NOT_ARCHIVED' using errcode = '22023';
      end if;
      update public.recipes set status = 'ACTIVE' where id = p_entity_id;
    else
      raise exception 'NOT_ALLOWED' using errcode = '42501';
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
$function$

;

CREATE OR REPLACE FUNCTION public.import_materials(p_rows jsonb, p_approve boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
      (id, name, brand, no_brand, specification, material_type_id, description, abv, bx,
       espresso_calibration, filter_calibration)
    values (
      v_material_id, btrim(r ->> 'name'),
      case when (r ->> 'no_brand')::boolean then null else btrim(r ->> 'brand') end,
      (r ->> 'no_brand')::boolean,
      nullif(btrim(coalesce(r ->> 'specification', '')), ''),
      (r ->> 'material_type_id')::uuid,
      nullif(btrim(coalesce(r ->> 'description', '')), ''),
      (r ->> 'abv')::numeric, (r ->> 'bx')::numeric,
      coalesce((r ->> 'espresso_calibration')::boolean, false),
      coalesce((r ->> 'filter_calibration')::boolean, false));
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
$function$

;
