-- Admin edits the system values on the Settings page. Decided with Nelson 2026-10-28:
--   * Material types and outlets: add, rename, reorder, and delete. One that is already
--     used cannot be deleted; it is disabled instead (hidden from new choices).
--   * Beverage style, temperature and strength: only the English and Chinese display
--     names and the order change; the stored values stay fixed.
--   * Unit, currency and language stay fixed.

-- Outlets get an order --------------------------------------------------------------

alter table public.outlets add column sort_order integer;
update public.outlets o set sort_order = n.rn
  from (select id, row_number() over (order by created_at, code) rn from public.outlets) n
 where n.id = o.id;
alter table public.outlets alter column sort_order set not null;
-- New outlets go to the end unless the Admin moves them.
alter table public.outlets alter column sort_order set default 1000;

-- Display names and order of fixed options ---------------------------------------------

create table public.option_labels (
  option_group text not null check (option_group in ('STYLE', 'TEMP', 'STRENGTH')),
  value text not null,
  label_en text not null check (char_length(btrim(label_en)) between 1 and 40),
  label_zh text not null check (char_length(btrim(label_zh)) between 1 and 40),
  sort_order integer not null,
  updated_at timestamptz not null default now(),
  revision integer not null default 1,
  primary key (option_group, value)
);
create trigger option_labels_touch before update on public.option_labels
  for each row execute function private.touch_row();

-- The values are fixed: only names and order may change.
create function private.option_labels_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.option_group <> old.option_group or new.value <> old.value then
    raise exception 'Option values are fixed; only names and order change' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger option_labels_guard before update on public.option_labels
  for each row execute function private.option_labels_guard();

insert into public.option_labels (option_group, value, label_en, label_zh, sort_order) values
  ('STYLE', 'COFFEE', 'Coffee', '咖啡', 1),
  ('STYLE', 'TEA', 'Tea', '茶', 2),
  ('STYLE', 'COCKTAIL', 'Cocktail', '鸡尾酒', 3),
  ('STYLE', 'MOCKTAIL', 'Mocktail', '无酒精鸡尾酒', 4),
  ('STYLE', 'PREP_MATERIAL', 'Prep Material', '预制原料', 5),
  ('TEMP', 'HOT', 'Hot', '热', 1),
  ('TEMP', 'COLD', 'Cold', '冷', 2),
  ('TEMP', 'FROZEN', 'Frozen', '冰沙', 3),
  ('STRENGTH', '0', '0', '0', 1),
  ('STRENGTH', '1', '1', '1', 2),
  ('STRENGTH', '2', '2', '2', 3),
  ('STRENGTH', '3', '3', '3', 4),
  ('STRENGTH', '4', '4', '4', 5),
  ('STRENGTH', '5', '5', '5', 6);

alter table public.option_labels enable row level security;
-- Display names are not sensitive; the app reads them without a session to build its texts.
create policy option_labels_select on public.option_labels for select to anon, authenticated
  using (true);
grant select on public.option_labels to anon, authenticated;
create policy option_labels_admin_update on public.option_labels for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
revoke insert, delete on public.option_labels from anon, authenticated;

-- Delete, or disable when in use ---------------------------------------------------------

-- Returns 'DELETED', or 'DISABLED' when something still refers to the value.
create function public.remove_setting_value(p_group text, p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_group not in ('MATERIAL_TYPE', 'OUTLET') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  begin
    if p_group = 'MATERIAL_TYPE' then
      delete from public.material_types where id = p_id;
    else
      delete from public.outlets where id = p_id;
    end if;
    if not found then
      raise exception 'NOT_FOUND' using errcode = '22023';
    end if;
    return 'DELETED';
  exception when foreign_key_violation then
    if p_group = 'MATERIAL_TYPE' then
      update public.material_types set is_active = false where id = p_id;
    else
      update public.outlets set is_active = false where id = p_id;
    end if;
    return 'DISABLED';
  end;
end;
$$;

-- Saves a new order: p_ids lists every value of the group, first to last.
create function public.reorder_setting_values(p_group text, p_ids text[]) returns void
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
  else
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function
  public.remove_setting_value(text, uuid),
  public.reorder_setting_values(text, text[])
from public, anon;
grant execute on function
  public.remove_setting_value(text, uuid),
  public.reorder_setting_values(text, text[])
to authenticated;
