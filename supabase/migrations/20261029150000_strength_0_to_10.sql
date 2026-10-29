-- Strength (flavour score) goes from 0–5 to 0–10. No recipe has a score yet, so no data
-- is converted. Levels 6–10 are added after the Admin's current order; 0–5 keep theirs.

do $$
declare
  k text;
begin
  foreach k in array array['sour', 'sweet', 'bitter', 'salty', 'umami', 'spicy', 'smoky', 'zesty',
                           'funky', 'earthy', 'oily'] loop
    execute format('alter table public.recipe_versions drop constraint recipe_versions_taste_%s_check', k);
    execute format('alter table public.recipe_versions add constraint recipe_versions_taste_%1$s_check
                    check (taste_%1$s between 0 and 10)', k);
  end loop;
end;
$$;

insert into public.option_labels (option_group, value, label_en, label_zh, sort_order)
select 'STRENGTH', v::text, v::text, v::text,
       (select coalesce(max(sort_order), 0) from public.option_labels where option_group = 'STRENGTH') + v - 5
  from generate_series(6, 10) v
on conflict (option_group, value) do nothing;
