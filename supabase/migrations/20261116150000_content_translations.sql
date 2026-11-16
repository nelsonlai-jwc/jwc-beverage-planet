-- AI translation of user-entered content (Nelson, 2026-11-16).
-- Each distinct text is stored once with its English, Chinese and Malay versions, keyed by
-- md5 of the original text. Changing the original gives a new key, so it is translated
-- again and an older manual correction no longer applies.

create table public.content_translations (
  source_hash text primary key,
  source text not null,
  en text not null,
  zh text not null,
  ms text not null,
  -- true when an Admin corrected it by hand.
  is_manual boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_hash = md5(source)),
  check (char_length(en) <= 4000 and char_length(zh) <= 4000 and char_length(ms) <= 4000)
);

alter table public.content_translations enable row level security;
create policy content_translations_select on public.content_translations for select to authenticated
  using (private.current_user_role() is not null);
grant select on public.content_translations to authenticated;
revoke insert, update, delete on public.content_translations from anon, authenticated;

-- Only texts that are a current value of a translated field can be stored.
create function private.is_translatable_text(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.materials
                  where name = p or description = p or specification = p)
      or exists (select 1 from public.packaging_items where name = p or description = p)
      or exists (select 1 from public.recipe_versions
                  where product_name = p or garnish = p or tasting_notes = p or appearance_notes = p
                     or cup_type = p or serving_size = p or storage_method = p or shelf_life = p)
      or exists (select 1 from public.recipe_steps where instruction = p)
      or exists (select 1 from public.menus where name = p)
      or exists (select 1 from public.menu_categories where name = p);
$$;

-- AI translations, written after a page showed texts that had none yet. Never replaces an
-- existing row (so a manual correction stays). p_rows: [{source, en, zh, ms}, ...].
create function public.save_ai_translations(p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
  v_count integer := 0;
  v_done integer;
begin
  if private.current_user_role() is null then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if coalesce(v_row ->> 'source', '') = ''
       or coalesce(btrim(v_row ->> 'en'), '') = ''
       or coalesce(btrim(v_row ->> 'zh'), '') = ''
       or coalesce(btrim(v_row ->> 'ms'), '') = ''
       or not private.is_translatable_text(v_row ->> 'source') then
      continue;
    end if;
    insert into public.content_translations (source_hash, source, en, zh, ms, updated_by)
    values (md5(v_row ->> 'source'), v_row ->> 'source',
            btrim(v_row ->> 'en'), btrim(v_row ->> 'zh'), btrim(v_row ->> 'ms'), auth.uid())
    on conflict (source_hash) do nothing;
    get diagnostics v_done = row_count;
    v_count := v_count + v_done;
  end loop;
  return v_count;
end;
$$;

-- Admin corrects the translation of one text by hand.
create function public.save_manual_translation(p_source text, p_en text, p_zh text, p_ms text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if coalesce(p_source, '') = '' or coalesce(btrim(p_en), '') = '' or coalesce(btrim(p_zh), '') = ''
     or coalesce(btrim(p_ms), '') = '' then
    raise exception 'INVALID' using errcode = '23514';
  end if;
  if not private.is_translatable_text(p_source) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.content_translations (source_hash, source, en, zh, ms, is_manual, updated_by)
  values (md5(p_source), p_source, btrim(p_en), btrim(p_zh), btrim(p_ms), true, auth.uid())
  on conflict (source_hash) do update
    set en = excluded.en, zh = excluded.zh, ms = excluded.ms, is_manual = true,
        updated_by = excluded.updated_by, updated_at = now();
end;
$$;

revoke execute on function public.save_ai_translations(jsonb) from public, anon;
grant execute on function public.save_ai_translations(jsonb) to authenticated;
revoke execute on function public.save_manual_translation(text, text, text, text) from public, anon;
grant execute on function public.save_manual_translation(text, text, text, text) to authenticated;
