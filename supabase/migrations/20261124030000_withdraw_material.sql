-- Feedback #12: the submitter (or an Admin) takes a pending new raw material back to
-- draft to fix it, then submits again. Its pending packs and prices go back with it.
create or replace function public.withdraw_material(p_material_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_material public.materials;
begin
  perform private.require_admin_or_manager();
  select * into v_material from public.materials where id = p_material_id for update;
  if not found or v_material.status <> 'PENDING' then
    raise exception 'NOT_PENDING' using errcode = '22023';
  end if;
  perform private.require_owner_or_admin(v_material.created_by);

  update public.material_price_versions pv set status = 'DRAFT'
    from public.material_packs p
   where p.id = pv.pack_id and p.material_id = p_material_id
     and pv.status = 'PENDING';
  update public.material_packs set status = 'DRAFT'
   where material_id = p_material_id and status = 'PENDING';
  update public.materials set status = 'DRAFT', updated_by = auth.uid()
   where id = p_material_id;
  perform private.log_approval('MATERIAL', p_material_id, 'WITHDRAW');
end;
$$;

revoke all on function public.withdraw_material(uuid) from public, anon;
grant execute on function public.withdraw_material(uuid) to authenticated;
