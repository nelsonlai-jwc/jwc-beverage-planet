-- Coffee beans from the JWC online shop (www.justwantcoffee.com) and an "Unavailable" setting
-- on raw materials.
--
-- * materials.unavailable: hidden from the recipe ingredient picker and the calibration bean
--   pickers. Recipes and costs that already use the material are not affected.
-- * materials.shop_variant_id: the shop product size (Shopify variant) this material is, so a
--   later sync recognises it. One material per variant.
-- * set_material_unavailable: Super Admin or an outlet Admin switches it by hand.
-- * sync_shop_beans: Super Admin only. Links existing materials to shop sizes, adds new beans
--   (approved at once), and copies the shop's availability onto every linked material.

alter table public.materials
  add column unavailable boolean not null default false,
  add column shop_variant_id bigint;

create unique index materials_shop_variant_unique
  on public.materials (shop_variant_id) where shop_variant_id is not null;

create function public.set_material_unavailable(p_material_id uuid, p_unavailable boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_admin() or private.is_outlet_admin()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  update public.materials
     set unavailable = coalesce(p_unavailable, false), updated_by = auth.uid()
   where id = p_material_id and status <> 'ARCHIVED';
  if not found then
    raise exception 'NOT_FOUND' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.set_material_unavailable(uuid, boolean) from public, anon;
grant execute on function public.set_material_unavailable(uuid, boolean) to authenticated;

-- p_links:    [{ "material_id": uuid, "variant_id": bigint }]   existing materials matched by name
-- p_new:      [{ "variant_id", "name", "grams", "price", "espresso", "filter" }]   beans to add
-- p_variants: [{ "variant_id", "available" }]   every coffee bean size on the shop right now
-- A linked material whose size is no longer on the shop counts as unavailable.
create function public.sync_shop_beans(p_links jsonb, p_new jsonb, p_variants jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb;
  v_type uuid;
  v_material uuid;
  v_pack uuid;
  v_linked integer := 0;
  v_created integer := 0;
  v_unavailable integer := 0;
  v_available integer := 0;
begin
  if not private.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  select id into v_type from public.material_types where lower(btrim(name)) = 'coffee bean';
  if v_type is null then
    raise exception 'NO_COFFEE_BEAN_TYPE' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_links, '[]')) loop
    update public.materials
       set shop_variant_id = (r ->> 'variant_id')::bigint
     where id = (r ->> 'material_id')::uuid
       and shop_variant_id is null
       and status <> 'ARCHIVED'
       and not exists (select 1 from public.materials
                        where shop_variant_id = (r ->> 'variant_id')::bigint);
    if found then
      v_linked := v_linked + 1;
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_new, '[]')) loop
    -- Skipped when this size or a product with the same name and brand is already there.
    if exists (select 1 from public.materials where shop_variant_id = (r ->> 'variant_id')::bigint)
       or exists (select 1 from public.materials
                   where status <> 'ARCHIVED'
                     and name_normalized = private.normalize_text(r ->> 'name')
                     and brand_normalized = private.normalize_text('JWC Roastery')
                     and specification_normalized = private.normalize_text(null)) then
      continue;
    end if;
    v_material := gen_random_uuid();
    v_pack := gen_random_uuid();
    insert into public.materials
      (id, name, brand, no_brand, material_type_id, espresso_calibration, filter_calibration, shop_variant_id)
    values (v_material, btrim(r ->> 'name'), 'JWC Roastery', false, v_type,
            coalesce((r ->> 'espresso')::boolean, false), coalesce((r ->> 'filter')::boolean, false),
            (r ->> 'variant_id')::bigint);
    insert into public.material_packs (id, material_id, pack_quantity, unit)
    values (v_pack, v_material, (r ->> 'grams')::numeric, 'g');
    update public.materials set cost_pack_id = v_pack where id = v_material;
    insert into public.material_price_versions (pack_id, price)
    values (v_pack, (r ->> 'price')::numeric);
    perform public.submit_material(v_material);
    perform public.approve_material(v_material);
    v_created := v_created + 1;
  end loop;

  with shop as (
    select (e ->> 'variant_id')::bigint as variant_id, coalesce((e ->> 'available')::boolean, false) as available
      from jsonb_array_elements(coalesce(p_variants, '[]')) e
  ), wanted as (
    select m.id, not coalesce(s.available, false) as unavailable
      from public.materials m
      left join shop s on s.variant_id = m.shop_variant_id
     where m.shop_variant_id is not null and m.status <> 'ARCHIVED'
  ), changed as (
    update public.materials m
       set unavailable = w.unavailable, updated_by = auth.uid()
      from wanted w
     where m.id = w.id and m.unavailable <> w.unavailable
    returning m.unavailable
  )
  select count(*) filter (where unavailable), count(*) filter (where not unavailable)
    into v_unavailable, v_available
    from changed;

  return jsonb_build_object('linked', v_linked, 'created', v_created,
                            'unavailable', v_unavailable, 'available', v_available);
end;
$$;

revoke all on function public.sync_shop_beans(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.sync_shop_beans(jsonb, jsonb, jsonb) to authenticated;

-- Nelson 2026-11-24: this bean is the shop's "Ethiopia Banko Chelchele #1 Natural" 200g, and
-- its name should not be in capitals.
alter table public.materials disable trigger materials_edit_guard;
update public.materials
   set name = 'JWC Single Origin Filter - Ethiopia Banko Chelchele G1 Natural 200g',
       shop_variant_id = 45905037590663
 where name = 'JWC Single Origin Filter - Ethiopia Banko CHELCHELE G1 Natural 200g'
   and status <> 'ARCHIVED'
   and not exists (select 1 from public.materials where shop_variant_id = 45905037590663);
alter table public.materials enable trigger materials_edit_guard;
