-- Approval workflow for shared materials, packs, prices and packaging, plus cost calculation.
-- Functions and one view only; no table changes.
-- Spec: design plan V0.2 ch. 7, 11, 14, 19; decisions O08, O09, O10.

-- Approval helpers -------------------------------------------------------

create function private.require_admin_or_manager() returns void
language plpgsql stable set search_path = '' as $$
begin
  if not private.is_admin_or_manager() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
end;
$$;

create function private.require_admin() returns void
language plpgsql stable set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
end;
$$;

create function private.log_approval(p_entity text, p_id uuid, p_action text, p_reason text default null)
returns void
language sql set search_path = '' as $$
  insert into public.approval_events (entity_type, entity_id, action, reason, actor_id)
  values (p_entity, p_id, p_action, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid());
$$;

create function private.require_reason(p_reason text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
end;
$$;

-- Approving a price replaces the pack's current price; the old one stays as history (ch. 14.3).
create function private.approve_material_price_row(p_price_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_pack_id uuid;
begin
  select pack_id into v_pack_id from public.material_price_versions where id = p_price_id;
  update public.material_price_versions
     set status = 'SUPERSEDED'
   where pack_id = v_pack_id and status = 'APPROVED';
  update public.material_price_versions
     set status = 'APPROVED', approved_by = auth.uid(), approved_at = now(), effective_from = now()
   where id = p_price_id;
end;
$$;

create function private.approve_packaging_price_row(p_price_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_item_id uuid;
begin
  select packaging_item_id into v_item_id from public.packaging_prices where id = p_price_id;
  update public.packaging_prices
     set status = 'SUPERSEDED'
   where packaging_item_id = v_item_id and status = 'APPROVED';
  update public.packaging_prices
     set status = 'APPROVED', approved_by = auth.uid(), approved_at = now(), effective_from = now()
   where id = p_price_id;
end;
$$;

-- Materials (new product with its packs and prices) ----------------------

-- Submitting a material also submits its draft packs and prices (ch. 7.2).
create function public.submit_material(p_material_id uuid) returns void
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

create function public.approve_material(p_material_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.approval_status;
  v_price_id uuid;
begin
  perform private.require_admin();
  select status into v_status from public.materials where id = p_material_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;

  update public.material_packs
     set status = 'APPROVED', approved_by = auth.uid(), approved_at = now()
   where material_id = p_material_id and status = 'PENDING';
  for v_price_id in
    select pv.id from public.material_price_versions pv
      join public.material_packs p on p.id = pv.pack_id
     where p.material_id = p_material_id and pv.status = 'PENDING'
  loop
    perform private.approve_material_price_row(v_price_id);
  end loop;
  update public.materials
     set status = 'APPROVED', approved_by = auth.uid(), approved_at = now()
   where id = p_material_id;
  perform private.log_approval('MATERIAL', p_material_id, 'APPROVE');
end;
$$;

create function public.return_material(p_material_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.approval_status;
begin
  perform private.require_admin();
  perform private.require_reason(p_reason);
  select status into v_status from public.materials where id = p_material_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;

  update public.material_packs set status = 'RETURNED'
   where material_id = p_material_id and status = 'PENDING';
  update public.material_price_versions pv set status = 'RETURNED'
    from public.material_packs p
   where p.id = pv.pack_id and p.material_id = p_material_id and pv.status = 'PENDING';
  update public.materials set status = 'RETURNED' where id = p_material_id;
  perform private.log_approval('MATERIAL', p_material_id, 'RETURN', p_reason);
end;
$$;

-- Extra pack on an approved material (ch. 19.1: a different pack size is a new Pack).
create function public.submit_material_pack(p_pack_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pack public.material_packs;
begin
  perform private.require_admin_or_manager();
  select * into v_pack from public.material_packs where id = p_pack_id for update;
  if not found or v_pack.status not in ('DRAFT', 'RETURNED') then
    raise exception 'NOT_SUBMITTABLE' using errcode = '22023';
  end if;
  if not exists (select 1 from public.materials where id = v_pack.material_id and status = 'APPROVED') then
    raise exception 'MATERIAL_NOT_APPROVED' using errcode = '22023';
  end if;

  update public.material_price_versions set status = 'PENDING'
   where pack_id = p_pack_id and status in ('DRAFT', 'RETURNED');
  update public.material_packs set status = 'PENDING' where id = p_pack_id;
  perform private.log_approval('MATERIAL_PACK', p_pack_id, 'SUBMIT');
end;
$$;

create function public.approve_material_pack(p_pack_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.approval_status;
  v_price_id uuid;
begin
  perform private.require_admin();
  select status into v_status from public.material_packs where id = p_pack_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;

  update public.material_packs
     set status = 'APPROVED', approved_by = auth.uid(), approved_at = now()
   where id = p_pack_id;
  for v_price_id in
    select id from public.material_price_versions where pack_id = p_pack_id and status = 'PENDING'
  loop
    perform private.approve_material_price_row(v_price_id);
  end loop;
  perform private.log_approval('MATERIAL_PACK', p_pack_id, 'APPROVE');
end;
$$;

create function public.return_material_pack(p_pack_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.approval_status;
begin
  perform private.require_admin();
  perform private.require_reason(p_reason);
  select status into v_status from public.material_packs where id = p_pack_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;

  update public.material_price_versions set status = 'RETURNED'
   where pack_id = p_pack_id and status = 'PENDING';
  update public.material_packs set status = 'RETURNED' where id = p_pack_id;
  perform private.log_approval('MATERIAL_PACK', p_pack_id, 'RETURN', p_reason);
end;
$$;

-- Price change on an approved pack; the current price stays in effect until approval.
create function public.submit_material_price(p_price_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_price public.material_price_versions;
begin
  perform private.require_admin_or_manager();
  select * into v_price from public.material_price_versions where id = p_price_id for update;
  if not found or v_price.status not in ('DRAFT', 'RETURNED') then
    raise exception 'NOT_SUBMITTABLE' using errcode = '22023';
  end if;
  if not exists (select 1 from public.material_packs where id = v_price.pack_id and status = 'APPROVED') then
    raise exception 'PACK_NOT_APPROVED' using errcode = '22023';
  end if;
  if exists (select 1 from public.material_price_versions
              where pack_id = v_price.pack_id and status = 'PENDING') then
    raise exception 'PRICE_ALREADY_PENDING' using errcode = '22023';
  end if;

  update public.material_price_versions set status = 'PENDING' where id = p_price_id;
  perform private.log_approval('MATERIAL_PRICE', p_price_id, 'SUBMIT');
end;
$$;

create function public.approve_material_price(p_price_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.approval_status;
begin
  perform private.require_admin();
  select status into v_status from public.material_price_versions where id = p_price_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;
  perform private.approve_material_price_row(p_price_id);
  perform private.log_approval('MATERIAL_PRICE', p_price_id, 'APPROVE');
end;
$$;

create function public.return_material_price(p_price_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.approval_status;
begin
  perform private.require_admin();
  perform private.require_reason(p_reason);
  select status into v_status from public.material_price_versions where id = p_price_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;
  update public.material_price_versions set status = 'RETURNED' where id = p_price_id;
  perform private.log_approval('MATERIAL_PRICE', p_price_id, 'RETURN', p_reason);
end;
$$;

-- Packaging items, priced per piece (O08) --------------------------------

create function public.submit_packaging_item(p_item_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.approval_status;
begin
  perform private.require_admin_or_manager();
  select status into v_status from public.packaging_items where id = p_item_id for update;
  if v_status is null or v_status not in ('DRAFT', 'RETURNED') then
    raise exception 'NOT_SUBMITTABLE' using errcode = '22023';
  end if;

  update public.packaging_prices set status = 'PENDING'
   where packaging_item_id = p_item_id and status in ('DRAFT', 'RETURNED');
  update public.packaging_items set status = 'PENDING' where id = p_item_id;
  perform private.log_approval('PACKAGING_ITEM', p_item_id, 'SUBMIT');
end;
$$;

create function public.approve_packaging_item(p_item_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.approval_status;
  v_price_id uuid;
begin
  perform private.require_admin();
  select status into v_status from public.packaging_items where id = p_item_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;

  for v_price_id in
    select id from public.packaging_prices where packaging_item_id = p_item_id and status = 'PENDING'
  loop
    perform private.approve_packaging_price_row(v_price_id);
  end loop;
  update public.packaging_items
     set status = 'APPROVED', approved_by = auth.uid(), approved_at = now()
   where id = p_item_id;
  perform private.log_approval('PACKAGING_ITEM', p_item_id, 'APPROVE');
end;
$$;

create function public.return_packaging_item(p_item_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.approval_status;
begin
  perform private.require_admin();
  perform private.require_reason(p_reason);
  select status into v_status from public.packaging_items where id = p_item_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;

  update public.packaging_prices set status = 'RETURNED'
   where packaging_item_id = p_item_id and status = 'PENDING';
  update public.packaging_items set status = 'RETURNED' where id = p_item_id;
  perform private.log_approval('PACKAGING_ITEM', p_item_id, 'RETURN', p_reason);
end;
$$;

create function public.submit_packaging_price(p_price_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_price public.packaging_prices;
begin
  perform private.require_admin_or_manager();
  select * into v_price from public.packaging_prices where id = p_price_id for update;
  if not found or v_price.status not in ('DRAFT', 'RETURNED') then
    raise exception 'NOT_SUBMITTABLE' using errcode = '22023';
  end if;
  if not exists (select 1 from public.packaging_items
                  where id = v_price.packaging_item_id and status = 'APPROVED') then
    raise exception 'PACKAGING_NOT_APPROVED' using errcode = '22023';
  end if;
  if exists (select 1 from public.packaging_prices
              where packaging_item_id = v_price.packaging_item_id and status = 'PENDING') then
    raise exception 'PRICE_ALREADY_PENDING' using errcode = '22023';
  end if;

  update public.packaging_prices set status = 'PENDING' where id = p_price_id;
  perform private.log_approval('PACKAGING_PRICE', p_price_id, 'SUBMIT');
end;
$$;

create function public.approve_packaging_price(p_price_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.approval_status;
begin
  perform private.require_admin();
  select status into v_status from public.packaging_prices where id = p_price_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;
  perform private.approve_packaging_price_row(p_price_id);
  perform private.log_approval('PACKAGING_PRICE', p_price_id, 'APPROVE');
end;
$$;

create function public.return_packaging_price(p_price_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.approval_status;
begin
  perform private.require_admin();
  perform private.require_reason(p_reason);
  select status into v_status from public.packaging_prices where id = p_price_id for update;
  if v_status is distinct from 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;
  update public.packaging_prices set status = 'RETURNED' where id = p_price_id;
  perform private.log_approval('PACKAGING_PRICE', p_price_id, 'RETURN', p_reason);
end;
$$;

-- Cost calculation (ch. 14) ----------------------------------------------
-- Exact numeric arithmetic throughout; rounding is left to display. A missing
-- input yields a reason code, never a zero (O09).

-- Unit cost of a material: current approved price of its costing pack / pack size.
create function private.material_cost(p_material_id uuid)
returns table (
  pack_id uuid,
  pack_quantity numeric,
  unit public.measure_unit,
  price_version_id uuid,
  price numeric,
  unit_cost numeric,
  reason text
)
language sql stable set search_path = '' as $$
  select p.id, p.pack_quantity, p.unit, pv.id, pv.price,
         pv.price / p.pack_quantity,
         case when p.id is null then 'COST_PACK_MISSING'
              when pv.id is null then 'PRICE_MISSING' end
    from public.materials m
    left join public.material_packs p on p.id = m.cost_pack_id and p.status = 'APPROVED'
    left join public.material_price_versions pv on pv.pack_id = p.id and pv.status = 'APPROVED'
   where m.id = p_material_id;
$$;
grant execute on function private.material_cost(uuid) to authenticated;

-- Current unit cost per material for lists and pickers (Admin and Manager only).
create view public.material_current_costs with (security_invoker = true) as
  select m.id as material_id, c.*
    from public.materials m
   cross join lateral private.material_cost(m.id) c
   where private.is_admin_or_manager();
revoke all on public.material_current_costs from anon;
grant select on public.material_current_costs to authenticated;

create function public.material_unit_cost(p_material_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_row record;
begin
  perform private.require_admin_or_manager();
  select * into v_row from private.material_cost(p_material_id);
  if not found then
    raise exception 'NOT_FOUND' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'material_id', p_material_id,
    'pack_id', v_row.pack_id,
    'pack_quantity', v_row.pack_quantity,
    'unit', v_row.unit,
    'price_version_id', v_row.price_version_id,
    'price', v_row.price,
    'unit_cost', v_row.unit_cost,
    'reason', v_row.reason);
end;
$$;

create function private.cost_reason(p_code text, p_line jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'code', p_code,
    'line_id', p_line ->> 'ingredient_id',
    'line_type', p_line ->> 'line_type',
    'display_name', p_line ->> 'display_name',
    'message', case p_code
      when 'QUANTITY_MISSING' then 'Quantity or unit is missing'
      when 'COST_PACK_MISSING' then 'Material has no approved costing pack'
      when 'PRICE_MISSING' then 'No approved purchase price'
      when 'UNIT_MISMATCH' then 'Unit does not match the costing unit'
      when 'PREP_NOT_APPROVED' then 'Prep Material has no approved version'
      when 'YIELD_MISSING' then 'Prep Material has no usable yield'
      when 'PREP_COST_INCOMPLETE' then 'Prep Material cost is incomplete'
      when 'CYCLE_DETECTED' then 'Recipe uses itself through Prep Material'
      when 'NO_INGREDIENTS' then 'Recipe has no ingredients'
      else p_code end);
$$;

-- Cost tree of one recipe version. p_path holds the recipe ids above it, for cycle checks.
create function private.recipe_cost_tree(p_version_id uuid, p_path uuid[])
returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_lines jsonb := '[]';
  v_reasons jsonb := '[]';
  v_total numeric := 0;
  v_complete boolean := true;
  v_has_ingredients boolean := false;
  r record;
  c record;
  v_line jsonb;
  v_code text;
  v_unit_cost numeric;
  v_prep_version public.recipe_versions;
  v_child jsonb;
begin
  for r in
    select ri.id, ri.material_id, ri.prep_recipe_id, ri.quantity, ri.unit,
           m.name as material_name, m.brand as material_brand,
           pr.current_approved_version_id as prep_version_id
      from public.recipe_ingredients ri
      left join public.materials m on m.id = ri.material_id
      left join public.recipes pr on pr.id = ri.prep_recipe_id
     where ri.recipe_version_id = p_version_id
     order by ri.sort_order
  loop
    v_has_ingredients := true;
    v_code := null;
    v_unit_cost := null;
    v_child := null;

    if r.material_id is not null then
      select * into c from private.material_cost(r.material_id);
      v_line := jsonb_build_object(
        'line_type', 'MATERIAL',
        'ingredient_id', r.id,
        'display_name', r.material_name || coalesce(' · ' || r.material_brand, ''),
        'material_id', r.material_id,
        'pack_id', c.pack_id,
        'price_version_id', c.price_version_id);
      if r.quantity is null or r.unit is null then
        v_code := 'QUANTITY_MISSING';
      elsif c.reason is not null then
        v_code := c.reason;
      elsif r.unit <> c.unit then
        v_code := 'UNIT_MISMATCH';
      else
        v_unit_cost := c.unit_cost;
      end if;
    else
      v_prep_version := null;
      if r.prep_version_id is not null then
        select * into v_prep_version from public.recipe_versions where id = r.prep_version_id;
      end if;
      v_line := jsonb_build_object(
        'line_type', 'PREP',
        'ingredient_id', r.id,
        'display_name', coalesce(v_prep_version.product_name, 'Prep Material'),
        'prep_recipe_id', r.prep_recipe_id,
        'prep_recipe_version_id', r.prep_version_id);
      if r.prep_recipe_id = any (p_path) then
        v_code := 'CYCLE_DETECTED';
      elsif r.prep_version_id is null then
        v_code := 'PREP_NOT_APPROVED';
      else
        v_child := private.recipe_cost_tree(r.prep_version_id, p_path || r.prep_recipe_id);
        v_reasons := v_reasons || (v_child -> 'incomplete_reasons');
        v_line := v_line || jsonb_build_object(
          'batch_cost', v_child -> 'total_cost',
          'yield_quantity', v_prep_version.yield_quantity,
          'yield_unit', v_prep_version.yield_unit,
          'children', v_child -> 'lines');
        if r.quantity is null or r.unit is null then
          v_code := 'QUANTITY_MISSING';
        elsif v_prep_version.yield_quantity is null then
          v_code := 'YIELD_MISSING';
        elsif r.unit <> v_prep_version.yield_unit then
          v_code := 'UNIT_MISMATCH';
        elsif jsonb_typeof(v_child -> 'total_cost') <> 'number' then
          v_code := 'PREP_COST_INCOMPLETE';
        else
          v_unit_cost := (v_child ->> 'total_cost')::numeric / v_prep_version.yield_quantity;
        end if;
      end if;
    end if;

    v_line := v_line || jsonb_build_object(
      'quantity', r.quantity,
      'unit', r.unit,
      'unit_cost', v_unit_cost,
      'line_cost', r.quantity * v_unit_cost,
      'incomplete_reason', v_code);
    if v_code is null then
      v_total := v_total + r.quantity * v_unit_cost;
    else
      v_complete := false;
      v_reasons := v_reasons || jsonb_build_array(private.cost_reason(v_code, v_line));
    end if;
    v_lines := v_lines || jsonb_build_array(v_line);
  end loop;

  if not v_has_ingredients then
    v_complete := false;
    v_reasons := v_reasons || jsonb_build_array(private.cost_reason('NO_INGREDIENTS', '{}'));
  end if;

  for r in
    select rp.id, rp.packaging_item_id, rp.pieces, pi.name, pi.brand,
           pp.id as price_id, pp.price_per_piece
      from public.recipe_packaging rp
      join public.packaging_items pi on pi.id = rp.packaging_item_id
      left join public.packaging_prices pp
        on pp.packaging_item_id = rp.packaging_item_id and pp.status = 'APPROVED'
     where rp.recipe_version_id = p_version_id
     order by rp.sort_order
  loop
    v_code := case when r.price_id is null then 'PRICE_MISSING' end;
    v_line := jsonb_build_object(
      'line_type', 'PACKAGING',
      'ingredient_id', r.id,
      'display_name', r.name || coalesce(' · ' || r.brand, ''),
      'packaging_item_id', r.packaging_item_id,
      'packaging_price_id', r.price_id,
      'quantity', r.pieces,
      'unit', 'piece',
      'unit_cost', r.price_per_piece,
      'line_cost', r.pieces * r.price_per_piece,
      'incomplete_reason', v_code);
    if v_code is null then
      v_total := v_total + r.pieces * r.price_per_piece;
    else
      v_complete := false;
      v_reasons := v_reasons || jsonb_build_array(private.cost_reason(v_code, v_line));
    end if;
    v_lines := v_lines || jsonb_build_array(v_line);
  end loop;

  return jsonb_build_object(
    'total_cost', case when v_complete then v_total end,
    'is_complete', v_complete,
    'incomplete_reasons', v_reasons,
    'lines', v_lines);
end;
$$;

-- Drink or Prep cost for one recipe version; Admin, or a Manager of the recipe's outlet.
-- Prep lines follow the Prep recipe's current approved version (O07).
create function public.calculate_recipe_cost(p_version_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_recipe public.recipes;
begin
  select r.* into v_recipe
    from public.recipe_versions v join public.recipes r on r.id = v.recipe_id
   where v.id = p_version_id;
  if not found or not private.can_manage_outlet(v_recipe.outlet_id) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'recipe_version_id', p_version_id,
    'currency', 'MYR',
    'calculated_at', now())
    || private.recipe_cost_tree(p_version_id, array[v_recipe.id]);
end;
$$;

-- Number of active recipes whose approved version uses an item, directly or through Prep (ch. 19.3).
create function private.recipes_using(p_material_id uuid, p_packaging_item_id uuid)
returns integer
language sql stable set search_path = '' as $$
  with recursive used (recipe_id) as (
    select r.id
      from public.recipes r
      join public.recipe_ingredients ri on ri.recipe_version_id = r.current_approved_version_id
     where r.status = 'ACTIVE' and ri.material_id = p_material_id
    union
    select r.id
      from public.recipes r
      join public.recipe_packaging rp on rp.recipe_version_id = r.current_approved_version_id
     where r.status = 'ACTIVE' and rp.packaging_item_id = p_packaging_item_id
    union
    select r.id
      from used u
      join public.recipe_ingredients ri on ri.prep_recipe_id = u.recipe_id
      join public.recipes r on r.current_approved_version_id = ri.recipe_version_id
     where r.status = 'ACTIVE'
  )
  select count(*)::integer from used;
$$;

create function public.material_affected_recipe_count(p_material_id uuid) returns integer
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin_or_manager();
  return private.recipes_using(p_material_id, null);
end;
$$;

create function public.packaging_affected_recipe_count(p_packaging_item_id uuid) returns integer
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin_or_manager();
  return private.recipes_using(null, p_packaging_item_id);
end;
$$;

grant execute on function private.require_admin_or_manager() to authenticated;

-- Business functions are for signed-in users only.
revoke execute on function
  public.submit_material(uuid), public.approve_material(uuid), public.return_material(uuid, text),
  public.submit_material_pack(uuid), public.approve_material_pack(uuid), public.return_material_pack(uuid, text),
  public.submit_material_price(uuid), public.approve_material_price(uuid), public.return_material_price(uuid, text),
  public.submit_packaging_item(uuid), public.approve_packaging_item(uuid), public.return_packaging_item(uuid, text),
  public.submit_packaging_price(uuid), public.approve_packaging_price(uuid), public.return_packaging_price(uuid, text),
  public.material_unit_cost(uuid), public.calculate_recipe_cost(uuid),
  public.material_affected_recipe_count(uuid), public.packaging_affected_recipe_count(uuid)
from public, anon;
grant execute on function
  public.submit_material(uuid), public.approve_material(uuid), public.return_material(uuid, text),
  public.submit_material_pack(uuid), public.approve_material_pack(uuid), public.return_material_pack(uuid, text),
  public.submit_material_price(uuid), public.approve_material_price(uuid), public.return_material_price(uuid, text),
  public.submit_packaging_item(uuid), public.approve_packaging_item(uuid), public.return_packaging_item(uuid, text),
  public.submit_packaging_price(uuid), public.approve_packaging_price(uuid), public.return_packaging_price(uuid, text),
  public.material_unit_cost(uuid), public.calculate_recipe_cost(uuid),
  public.material_affected_recipe_count(uuid), public.packaging_affected_recipe_count(uuid)
to authenticated;
