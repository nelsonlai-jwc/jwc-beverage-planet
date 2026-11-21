-- Calibration tabs (2026-11-21): the shot values are entered per drink in tabs
-- (espresso Black / White x Hot / Iced, filter Hot / Iced). Each filled tab saves as its own
-- Final for that one drink; test shots / brews belong to one tab again.
-- Only adds columns and functions; no data is removed.

alter table public.calibration_shots
  add column drink_type text check (drink_type in ('BLACK_HOT', 'BLACK_ICED', 'MILK_HOT', 'MILK_ICED'));

alter table public.filter_calibration_brews
  add column temperature text check (temperature in ('HOT', 'ICED'));

-- Several Finals in one transaction: all are saved, or none.
-- p_finals: [{ "record": {...}, "uses": ["BLACK_HOT"], "replace": [uuid, ...] }, ...]
create function public.save_espresso_calibrations(p_finals jsonb)
returns uuid[]
language plpgsql security invoker set search_path = '' as $$
declare
  v_final jsonb;
  v_ids uuid[] := '{}';
begin
  if jsonb_typeof(p_finals) is distinct from 'array' or jsonb_array_length(p_finals) = 0 then
    raise exception 'Nothing to save' using errcode = '23514';
  end if;
  for v_final in select value from jsonb_array_elements(p_finals) loop
    v_ids := v_ids || public.save_espresso_calibration(
      v_final->'record',
      array(select jsonb_array_elements_text(coalesce(v_final->'uses', '[]'))),
      array(select jsonb_array_elements_text(coalesce(v_final->'replace', '[]'))::uuid));
  end loop;
  return v_ids;
end;
$$;
revoke all on function public.save_espresso_calibrations(jsonb) from public, anon;
grant execute on function public.save_espresso_calibrations(jsonb) to authenticated;

create function public.save_filter_calibrations(p_finals jsonb)
returns uuid[]
language plpgsql security invoker set search_path = '' as $$
declare
  v_final jsonb;
  v_ids uuid[] := '{}';
begin
  if jsonb_typeof(p_finals) is distinct from 'array' or jsonb_array_length(p_finals) = 0 then
    raise exception 'Nothing to save' using errcode = '23514';
  end if;
  for v_final in select value from jsonb_array_elements(p_finals) loop
    v_ids := v_ids || public.save_filter_calibration(
      v_final->'record',
      array(select jsonb_array_elements_text(coalesce(v_final->'uses', '[]'))),
      array(select jsonb_array_elements_text(coalesce(v_final->'replace', '[]'))::uuid));
  end loop;
  return v_ids;
end;
$$;
revoke all on function public.save_filter_calibrations(jsonb) from public, anon;
grant execute on function public.save_filter_calibrations(jsonb) to authenticated;
