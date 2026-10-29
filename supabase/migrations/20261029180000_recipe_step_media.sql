-- Photo or video on each Processing Method step (Nelson, 2026-10-29).
-- recipe_steps.media_asset_id already exists; this lets that file be a video.
-- Photos stay JPEG/PNG/WebP up to 10 MB; videos are MP4/MOV/WebM up to 50 MB
-- (the Supabase free plan's per-file limit).

alter table public.media_assets drop constraint media_assets_mime_type_check;
alter table public.media_assets add constraint media_assets_mime_type_check
  check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'));

alter table public.media_assets drop constraint media_assets_size_bytes_check;
alter table public.media_assets add constraint media_assets_size_bytes_check
  check (size_bytes > 0 and size_bytes <= case when mime_type like 'video/%' then 52428800 else 10485760 end);

update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']
 where id = 'recipe-media';

-- Appearance photos (recipe_media) stay photos only.
create function private.recipe_media_image_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.media_assets where id = new.media_asset_id and mime_type not like 'image/%') then
    raise exception 'Appearance photos must be images' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger recipe_media_image_only before insert or update on public.recipe_media
  for each row execute function private.recipe_media_image_only();
