-- Admin can add beverage styles on the Settings page (Nelson, 2026-11-16), e.g. Chocolate.
-- A new style is added to the beverage_style list and gets its English and Chinese names
-- in option_labels, at the end of the order. Styles still cannot be deleted (a Postgres
-- enum value cannot be removed); they can be renamed and reordered as before.

-- Returns the stored value of the new style, e.g. 'CHOCOLATE'.
create function public.add_beverage_style(p_en text, p_zh text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_en text := btrim(coalesce(p_en, ''));
  v_zh text := btrim(coalesce(p_zh, ''));
  v_value text;
  v_n integer := 1;
begin
  perform private.require_admin();
  if char_length(v_en) not between 1 and 40 or char_length(v_zh) not between 1 and 40 then
    raise exception 'INVALID' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.option_labels
     where option_group = 'STYLE' and (lower(label_en) = lower(v_en) or label_zh = v_zh)
  ) then
    raise exception 'DUPLICATE' using errcode = '23505';
  end if;

  -- Stored value from the English name: capital letters, numbers and underscores.
  v_value := btrim(regexp_replace(upper(v_en), '[^A-Z0-9]+', '_', 'g'), '_');
  if v_value = '' then
    v_value := 'STYLE';
  end if;
  while exists (select 1 from pg_catalog.pg_enum
              where enumtypid = 'public.beverage_style'::regtype and enumlabel = v_value)
     or exists (select 1 from public.option_labels where option_group = 'STYLE' and value = v_value) loop
    v_n := v_n + 1;
    v_value := btrim(regexp_replace(upper(v_en), '[^A-Z0-9]+', '_', 'g'), '_');
    v_value := case when v_value = '' then 'STYLE' else v_value end || '_' || v_n;
  end loop;

  execute format('alter type public.beverage_style add value %L', v_value);
  insert into public.option_labels (option_group, value, label_en, label_zh, sort_order)
  select 'STYLE', v_value, v_en, v_zh, coalesce(max(sort_order), 0) + 1
    from public.option_labels where option_group = 'STYLE';
  return v_value;
end;
$$;

revoke execute on function public.add_beverage_style(text, text) from public, anon;
grant execute on function public.add_beverage_style(text, text) to authenticated;
