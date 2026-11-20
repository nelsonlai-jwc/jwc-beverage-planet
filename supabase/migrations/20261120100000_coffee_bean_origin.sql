-- Coffee Bean raw materials: origin, variety and process.
-- Each is picked from a preset list the Super Admin keeps on the Settings page, or typed
-- freely; the material stores the text (the English name when picked from a list).
-- Only a material of type "Coffee Bean" keeps them; any other type saves them as empty.

create table public.coffee_bean_options (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('ORIGIN', 'VARIETY', 'PROCESS')),
  name_en text not null check (char_length(btrim(name_en)) between 1 and 60),
  name_zh text not null check (char_length(btrim(name_zh)) between 1 and 60),
  name_ms text check (name_ms is null or char_length(btrim(name_ms)) between 1 and 60),
  sort_order integer not null default 0,
  is_active boolean not null default true
);
create unique index coffee_bean_options_name on public.coffee_bean_options (kind, lower(btrim(name_en)));

alter table public.coffee_bean_options enable row level security;
create policy coffee_bean_options_select on public.coffee_bean_options for select to authenticated
  using (true);
create policy coffee_bean_options_admin_insert on public.coffee_bean_options for insert to authenticated
  with check (private.is_admin());
create policy coffee_bean_options_admin_update on public.coffee_bean_options for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
grant select, insert, update on public.coffee_bean_options to authenticated;
revoke delete on public.coffee_bean_options from anon, authenticated;

insert into public.coffee_bean_options (kind, name_en, name_zh, sort_order) values
  ('ORIGIN', 'Ethiopia', '埃塞俄比亚', 1),
  ('ORIGIN', 'Kenya', '肯尼亚', 2),
  ('ORIGIN', 'Rwanda', '卢旺达', 3),
  ('ORIGIN', 'Burundi', '布隆迪', 4),
  ('ORIGIN', 'Tanzania', '坦桑尼亚', 5),
  ('ORIGIN', 'Uganda', '乌干达', 6),
  ('ORIGIN', 'DR Congo', '刚果民主共和国', 7),
  ('ORIGIN', 'Malawi', '马拉维', 8),
  ('ORIGIN', 'Zambia', '赞比亚', 9),
  ('ORIGIN', 'Zimbabwe', '津巴布韦', 10),
  ('ORIGIN', 'Cameroon', '喀麦隆', 11),
  ('ORIGIN', 'Côte d''Ivoire', '科特迪瓦', 12),
  ('ORIGIN', 'Mexico', '墨西哥', 13),
  ('ORIGIN', 'Guatemala', '危地马拉', 14),
  ('ORIGIN', 'Honduras', '洪都拉斯', 15),
  ('ORIGIN', 'El Salvador', '萨尔瓦多', 16),
  ('ORIGIN', 'Nicaragua', '尼加拉瓜', 17),
  ('ORIGIN', 'Costa Rica', '哥斯达黎加', 18),
  ('ORIGIN', 'Panama', '巴拿马', 19),
  ('ORIGIN', 'Jamaica', '牙买加', 20),
  ('ORIGIN', 'Dominican Republic', '多米尼加', 21),
  ('ORIGIN', 'Haiti', '海地', 22),
  ('ORIGIN', 'Cuba', '古巴', 23),
  ('ORIGIN', 'Puerto Rico', '波多黎各', 24),
  ('ORIGIN', 'Colombia', '哥伦比亚', 25),
  ('ORIGIN', 'Brazil', '巴西', 26),
  ('ORIGIN', 'Peru', '秘鲁', 27),
  ('ORIGIN', 'Ecuador', '厄瓜多尔', 28),
  ('ORIGIN', 'Bolivia', '玻利维亚', 29),
  ('ORIGIN', 'Venezuela', '委内瑞拉', 30),
  ('ORIGIN', 'Yemen', '也门', 31),
  ('ORIGIN', 'India', '印度', 32),
  ('ORIGIN', 'Indonesia', '印度尼西亚', 33),
  ('ORIGIN', 'Vietnam', '越南', 34),
  ('ORIGIN', 'China (Yunnan)', '中国（云南）', 35),
  ('ORIGIN', 'Thailand', '泰国', 36),
  ('ORIGIN', 'Laos', '老挝', 37),
  ('ORIGIN', 'Myanmar', '缅甸', 38),
  ('ORIGIN', 'Philippines', '菲律宾', 39),
  ('ORIGIN', 'Malaysia', '马来西亚', 40),
  ('ORIGIN', 'Taiwan', '台湾', 41),
  ('ORIGIN', 'Nepal', '尼泊尔', 42),
  ('ORIGIN', 'Papua New Guinea', '巴布亚新几内亚', 43),
  ('ORIGIN', 'Timor-Leste', '东帝汶', 44),
  ('ORIGIN', 'Australia', '澳大利亚', 45),
  ('ORIGIN', 'USA (Hawaii)', '美国（夏威夷）', 46),
  ('VARIETY', 'Typica', '铁皮卡', 1),
  ('VARIETY', 'Bourbon', '波旁', 2),
  ('VARIETY', 'Red Bourbon', '红波旁', 3),
  ('VARIETY', 'Yellow Bourbon', '黄波旁', 4),
  ('VARIETY', 'Pink Bourbon', '粉红波旁', 5),
  ('VARIETY', 'Caturra', '卡杜拉', 6),
  ('VARIETY', 'Catuai', '卡杜艾', 7),
  ('VARIETY', 'Red Catuai', '红卡杜艾', 8),
  ('VARIETY', 'Yellow Catuai', '黄卡杜艾', 9),
  ('VARIETY', 'Mundo Novo', '新世界', 10),
  ('VARIETY', 'Pacas', '帕卡斯', 11),
  ('VARIETY', 'Villa Sarchi', '薇拉萨奇', 12),
  ('VARIETY', 'Maragogype', '象豆', 13),
  ('VARIETY', 'Pacamara', '帕卡马拉', 14),
  ('VARIETY', 'Laurina (Bourbon Pointu)', '尖身波旁', 15),
  ('VARIETY', 'Mokka', '摩卡', 16),
  ('VARIETY', 'Java', '爪哇', 17),
  ('VARIETY', 'Gesha', '瑰夏', 18),
  ('VARIETY', 'Ethiopian Landrace (Heirloom)', '埃塞俄比亚原生种', 19),
  ('VARIETY', '74110', '74110', 20),
  ('VARIETY', '74112', '74112', 21),
  ('VARIETY', '74158', '74158', 22),
  ('VARIETY', 'Kurume', 'Kurume', 23),
  ('VARIETY', 'Wush Wush', 'Wush Wush', 24),
  ('VARIETY', 'Rume Sudan', 'Rume Sudan', 25),
  ('VARIETY', 'Sidra', 'Sidra', 26),
  ('VARIETY', 'Typica Mejorado', 'Typica Mejorado', 27),
  ('VARIETY', 'SL28', 'SL28', 28),
  ('VARIETY', 'SL34', 'SL34', 29),
  ('VARIETY', 'Ruiru 11', 'Ruiru 11', 30),
  ('VARIETY', 'Batian', 'Batian', 31),
  ('VARIETY', 'Catimor', '卡蒂姆', 32),
  ('VARIETY', 'Sarchimor', 'Sarchimor', 33),
  ('VARIETY', 'Castillo', '卡斯蒂略', 34),
  ('VARIETY', 'Colombia', 'Colombia', 35),
  ('VARIETY', 'Tabi', 'Tabi', 36),
  ('VARIETY', 'Marsellesa', 'Marsellesa', 37),
  ('VARIETY', 'Parainema', 'Parainema', 38),
  ('VARIETY', 'Lempira', 'Lempira', 39),
  ('VARIETY', 'IHCAFE 90', 'IHCAFE 90', 40),
  ('VARIETY', 'Obatã', 'Obatã', 41),
  ('VARIETY', 'Catucai', 'Catucai', 42),
  ('VARIETY', 'Arara', 'Arara', 43),
  ('VARIETY', 'Centroamericano (H1)', 'Centroamericano (H1)', 44),
  ('VARIETY', 'Starmaya', 'Starmaya', 45),
  ('VARIETY', 'S795 (Jember)', 'S795 (Jember)', 46),
  ('VARIETY', 'Tim Tim', 'Tim Tim', 47),
  ('VARIETY', 'Ateng', 'Ateng', 48),
  ('VARIETY', 'Sigarar Utang', 'Sigarar Utang', 49),
  ('VARIETY', 'Robusta (Canephora)', '罗布斯塔', 50),
  ('VARIETY', 'Liberica', '利比里卡', 51),
  ('VARIETY', 'Excelsa', '伊克赛尔萨', 52),
  ('PROCESS', 'Washed', '水洗', 1),
  ('PROCESS', 'Natural', '日晒', 2),
  ('PROCESS', 'Honey', '蜜处理', 3),
  ('PROCESS', 'White Honey', '白蜜', 4),
  ('PROCESS', 'Yellow Honey', '黄蜜', 5),
  ('PROCESS', 'Red Honey', '红蜜', 6),
  ('PROCESS', 'Black Honey', '黑蜜', 7),
  ('PROCESS', 'Pulped Natural', '去果皮日晒', 8),
  ('PROCESS', 'Wet-hulled (Giling Basah)', '湿刨', 9),
  ('PROCESS', 'Semi-washed', '半水洗', 10),
  ('PROCESS', 'Monsooned', '风渍', 11),
  ('PROCESS', 'Anaerobic Natural', '厌氧日晒', 12),
  ('PROCESS', 'Anaerobic Washed', '厌氧水洗', 13),
  ('PROCESS', 'Carbonic Maceration', '二氧化碳浸渍', 14),
  ('PROCESS', 'Lactic', '乳酸发酵', 15),
  ('PROCESS', 'Double Fermentation', '双重发酵', 16),
  ('PROCESS', 'Thermal Shock', '热冲击', 17),
  ('PROCESS', 'Yeast Fermentation', '酵母发酵', 18),
  ('PROCESS', 'Koji', '曲菌发酵', 19),
  ('PROCESS', 'Extended Fermentation', '酒酿 / 长时间发酵', 20),
  ('PROCESS', 'Co-fermented / Infused', '共同发酵', 21),
  ('PROCESS', 'Decaf (Swiss Water)', '低因（瑞士水处理）', 22),
  ('PROCESS', 'Decaf (Sugarcane EA)', '低因（甘蔗 EA）', 23),
  ('PROCESS', 'Decaf (CO2)', '低因（CO2）', 24);

alter table public.materials
  add column origin text check (origin is null or char_length(origin) <= 100),
  add column variety text check (variety is null or char_length(variety) <= 100),
  add column process text check (process is null or char_length(process) <= 100);

-- Same rule as calibration use: only a Coffee Bean keeps these.
create or replace function private.materials_calibration_use() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not private.is_coffee_bean_type(new.material_type_id) then
    new.espresso_calibration := false;
    new.filter_calibration := false;
    new.origin := null;
    new.variety := null;
    new.process := null;
  else
    new.origin := nullif(btrim(new.origin), '');
    new.variety := nullif(btrim(new.variety), '');
    new.process := nullif(btrim(new.process), '');
  end if;
  new.is_coffee_bean := new.espresso_calibration or new.filter_calibration;
  return new;
end;
$$;

create or replace function public.reorder_setting_values(p_group text, p_ids text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_group = 'MATERIAL_TYPE' then
    update public.material_types t set sort_order = o.n
      from unnest(p_ids) with ordinality o (id, n) where t.id = o.id::uuid;
  elsif p_group = 'OUTLET' then
    update public.outlets t set sort_order = o.n
      from unnest(p_ids) with ordinality o (id, n) where t.id = o.id::uuid;
  elsif p_group in ('STYLE', 'TEMP', 'STRENGTH') then
    update public.option_labels t set sort_order = o.n
      from unnest(p_ids) with ordinality o (value, n)
     where t.option_group = p_group and t.value = o.value;
  elsif p_group in ('ORIGIN', 'VARIETY', 'PROCESS') then
    update public.coffee_bean_options t set sort_order = o.n
      from unnest(p_ids) with ordinality o (id, n) where t.kind = p_group and t.id = o.id::uuid;
  else
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION private.editable_fields(p_entity_type text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_entity_type
    when 'MATERIAL' then array['name', 'brand', 'no_brand', 'specification', 'material_type_id',
                               'description', 'abv', 'bx', 'espresso_calibration', 'filter_calibration',
                               'origin', 'variety', 'process', 'photo_asset_id']
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
             origin = v_m.origin, variety = v_m.variety, process = v_m.process,
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
       espresso_calibration, filter_calibration, origin, variety, process)
    values (
      v_material_id, btrim(r ->> 'name'),
      case when (r ->> 'no_brand')::boolean then null else btrim(r ->> 'brand') end,
      (r ->> 'no_brand')::boolean,
      nullif(btrim(coalesce(r ->> 'specification', '')), ''),
      (r ->> 'material_type_id')::uuid,
      nullif(btrim(coalesce(r ->> 'description', '')), ''),
      (r ->> 'abv')::numeric, (r ->> 'bx')::numeric,
      coalesce((r ->> 'espresso_calibration')::boolean, false),
      coalesce((r ->> 'filter_calibration')::boolean, false),
      nullif(btrim(coalesce(r ->> 'origin', '')), ''),
      nullif(btrim(coalesce(r ->> 'variety', '')), ''),
      nullif(btrim(coalesce(r ->> 'process', '')), ''));
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
