-- Undo an approval pressed by mistake (Nelson, 2026-11-14).
-- An Admin sends the latest approval back to Pending approval and the previous
-- approved record takes effect again:
--   * RECIPE_VERSION: the current approved version goes back to PENDING and the
--     version it replaced becomes current again. Refused when the recipe already has
--     an open version. Undoing a recipe's first approval is refused while it is on a
--     published menu or used as Prep by another approved recipe.
--   * MATERIAL_PRICE / PACKAGING_PRICE: the current price goes back to PENDING and the
--     price it replaced is current again. Refused when another price is waiting or
--     there is no earlier price.
--   * MATERIAL: a newly approved material, its packs and prices go back to PENDING.
--     Refused once an approved recipe uses it or a later price change was approved.
-- Each undo is logged as a ROLLBACK approval event with the reason.

create function public.undo_approval(p_entity_type text, p_entity_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.recipe_versions;
  r public.recipes;
  v_prev uuid;
  v_blocker text;
  v_pack uuid;
  v_status public.approval_status;
begin
  perform private.require_admin();
  perform private.require_reason(p_reason);

  if p_entity_type = 'RECIPE_VERSION' then
    select * into v from public.recipe_versions where id = p_entity_id;
    if not found then
      raise exception 'NOT_FOUND' using errcode = '22023';
    end if;
    select * into r from public.recipes where id = v.recipe_id for update;
    select * into v from public.recipe_versions where id = p_entity_id for update;
    if v.status <> 'APPROVED' or r.current_approved_version_id is distinct from v.id then
      raise exception 'NOT_CURRENT_APPROVAL' using errcode = '22023';
    end if;
    if r.status <> 'ACTIVE' then
      raise exception 'RECIPE_ARCHIVED' using errcode = '22023';
    end if;
    if exists (select 1 from public.recipe_versions
                where recipe_id = r.id and status in ('DRAFT', 'PENDING', 'RETURNED')) then
      raise exception 'OPEN_VERSION_EXISTS' using errcode = '22023';
    end if;
    select id into v_prev from public.recipe_versions
     where recipe_id = r.id and status = 'SUPERSEDED'
     order by approved_at desc nulls last, version_no desc
     limit 1;
    if v_prev is null then
      v_blocker := private.recipe_archive_blocker(r.id);
      if v_blocker in ('ON_MENU', 'IN_USE') then
        raise exception '%', v_blocker using errcode = '22023';
      end if;
    end if;

    update public.recipe_versions
       set status = 'PENDING', approved_by = null, approved_at = null, updated_by = auth.uid()
     where id = v.id;
    if v_prev is not null then
      update public.recipe_versions set status = 'APPROVED' where id = v_prev;
    end if;
    update public.recipes set current_approved_version_id = v_prev where id = r.id;

    insert into public.approval_events (entity_type, entity_id, outlet_id, action, reason, actor_id)
    values ('RECIPE_VERSION', v.id, r.outlet_id, 'ROLLBACK', btrim(p_reason), auth.uid());

    insert into public.menu_publish_history (menu_id, outlet_id, event, snapshot, actor_id)
    select m.id, m.outlet_id, 'RECIPE_VERSION_UPDATE',
           jsonb_build_object('recipe_id', r.id, 'from_version_id', v.id, 'to_version_id', v_prev),
           auth.uid()
      from public.menus m
     where m.status = 'PUBLISHED'
       and exists (select 1 from public.menu_items mi where mi.menu_id = m.id and mi.recipe_id = r.id);

  elsif p_entity_type = 'MATERIAL_PRICE' then
    select status, pack_id into v_status, v_pack
      from public.material_price_versions where id = p_entity_id for update;
    if v_status is distinct from 'APPROVED' then
      raise exception 'NOT_CURRENT_APPROVAL' using errcode = '22023';
    end if;
    if exists (select 1 from public.material_price_versions
                where pack_id = v_pack and status in ('DRAFT', 'PENDING', 'RETURNED')) then
      raise exception 'OPEN_PRICE_EXISTS' using errcode = '22023';
    end if;
    select id into v_prev from public.material_price_versions
     where pack_id = v_pack and status = 'SUPERSEDED'
     order by effective_from desc, created_at desc
     limit 1;
    if v_prev is null then
      raise exception 'NO_PREVIOUS_PRICE' using errcode = '22023';
    end if;
    update public.material_price_versions
       set status = 'PENDING', approved_by = null, approved_at = null, effective_from = null
     where id = p_entity_id;
    update public.material_price_versions set status = 'APPROVED' where id = v_prev;
    perform private.log_approval('MATERIAL_PRICE', p_entity_id, 'ROLLBACK', p_reason);

  elsif p_entity_type = 'PACKAGING_PRICE' then
    select status, packaging_item_id into v_status, v_pack
      from public.packaging_prices where id = p_entity_id for update;
    if v_status is distinct from 'APPROVED' then
      raise exception 'NOT_CURRENT_APPROVAL' using errcode = '22023';
    end if;
    if exists (select 1 from public.packaging_prices
                where packaging_item_id = v_pack and status in ('DRAFT', 'PENDING', 'RETURNED')) then
      raise exception 'OPEN_PRICE_EXISTS' using errcode = '22023';
    end if;
    select id into v_prev from public.packaging_prices
     where packaging_item_id = v_pack and status = 'SUPERSEDED'
     order by effective_from desc, created_at desc
     limit 1;
    if v_prev is null then
      raise exception 'NO_PREVIOUS_PRICE' using errcode = '22023';
    end if;
    update public.packaging_prices
       set status = 'PENDING', approved_by = null, approved_at = null, effective_from = null
     where id = p_entity_id;
    update public.packaging_prices set status = 'APPROVED' where id = v_prev;
    perform private.log_approval('PACKAGING_PRICE', p_entity_id, 'ROLLBACK', p_reason);

  elsif p_entity_type = 'MATERIAL' then
    select status into v_status from public.materials where id = p_entity_id for update;
    if v_status is distinct from 'APPROVED' then
      raise exception 'NOT_CURRENT_APPROVAL' using errcode = '22023';
    end if;
    if private.recipes_using(p_entity_id, null) > 0 then
      raise exception 'IN_USE' using errcode = '22023';
    end if;
    if exists (select 1 from public.material_price_versions pv
                 join public.material_packs p on p.id = pv.pack_id
                where p.material_id = p_entity_id and pv.status = 'SUPERSEDED') then
      raise exception 'LATER_CHANGES' using errcode = '22023';
    end if;
    if exists (select 1 from public.change_requests
                where entity_type = 'MATERIAL' and entity_id = p_entity_id and status = 'PENDING') then
      raise exception 'REQUEST_ALREADY_PENDING' using errcode = '22023';
    end if;
    update public.material_price_versions pv
       set status = 'PENDING', approved_by = null, approved_at = null, effective_from = null
      from public.material_packs p
     where p.id = pv.pack_id and p.material_id = p_entity_id and pv.status = 'APPROVED';
    update public.material_packs
       set status = 'PENDING', approved_by = null, approved_at = null
     where material_id = p_entity_id and status = 'APPROVED';
    update public.materials
       set status = 'PENDING', approved_by = null, approved_at = null, updated_by = auth.uid()
     where id = p_entity_id;
    perform private.log_approval('MATERIAL', p_entity_id, 'ROLLBACK', p_reason);

  else
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.undo_approval(text, uuid, text) from public, anon;
grant execute on function public.undo_approval(text, uuid, text) to authenticated;
