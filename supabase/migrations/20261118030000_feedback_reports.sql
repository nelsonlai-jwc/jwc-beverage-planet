-- Feedback (Nelson, 2026-11-18): every signed-in user reports a bug or an idea,
-- with up to 5 photos. The submitter sees their own reports; the Super Admin sees
-- all, sets the status and writes one reply the submitter can read. No delete.

create table public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('BUG', 'IDEA')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null check (char_length(btrim(description)) between 1 and 4000),
  -- Where the user was and what they used, filled in by the app.
  page_url text check (char_length(page_url) <= 500),
  locale text check (char_length(locale) <= 10),
  device text check (device in ('PHONE', 'TABLET', 'DESKTOP')),
  user_agent text check (char_length(user_agent) <= 500),
  -- Storage paths in the feedback-media bucket, each under the submitter's folder.
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 5),
  status text not null default 'NEW'
    check (status in ('NEW', 'PLANNED', 'IN_PROGRESS', 'DONE', 'WONT_DO')),
  admin_reply text check (char_length(admin_reply) <= 2000),
  replied_at timestamptz,
  replied_by uuid references public.profiles (id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision integer not null default 1
);
create index feedback_reports_created_by on public.feedback_reports (created_by, created_at desc);
create index feedback_reports_created_at on public.feedback_reports (created_at desc);

create trigger feedback_reports_touch before update on public.feedback_reports
  for each row execute function private.touch_row();
create trigger audit_feedback_reports after insert or update or delete on public.feedback_reports
  for each row execute function private.audit_row();

-- A new report always starts as NEW with no reply, and its photos must be the
-- submitter's own uploads. After that only status and reply change.
create function private.feedback_reports_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_path text;
begin
  if tg_op = 'INSERT' then
    new.status := 'NEW';
    new.admin_reply := null;
    new.replied_at := null;
    new.replied_by := null;
    foreach v_path in array new.photo_paths loop
      if split_part(v_path, '/', 1) <> new.created_by::text then
        raise exception 'Photo is not the submitter''s upload' using errcode = '23514';
      end if;
    end loop;
    return new;
  end if;
  if new.kind is distinct from old.kind
     or new.title is distinct from old.title
     or new.description is distinct from old.description
     or new.page_url is distinct from old.page_url
     or new.locale is distinct from old.locale
     or new.device is distinct from old.device
     or new.user_agent is distinct from old.user_agent
     or new.photo_paths is distinct from old.photo_paths
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Only status and reply can change' using errcode = '23514';
  end if;
  if new.admin_reply is distinct from old.admin_reply then
    new.admin_reply := nullif(btrim(new.admin_reply), '');
    new.replied_at := case when new.admin_reply is null then null else now() end;
    new.replied_by := case when new.admin_reply is null then null else auth.uid() end;
  end if;
  return new;
end;
$$;
create trigger feedback_reports_guard before insert or update on public.feedback_reports
  for each row execute function private.feedback_reports_guard();

alter table public.feedback_reports enable row level security;

create policy feedback_reports_select on public.feedback_reports for select to authenticated
  using (created_by = auth.uid() or private.is_admin());
create policy feedback_reports_insert on public.feedback_reports for insert to authenticated
  with check (created_by = auth.uid() and private.current_user_role() is not null);
create policy feedback_reports_update on public.feedback_reports for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

grant select, insert, update on public.feedback_reports to authenticated;

-- Photos: private bucket, files under <user id>/. Readable by the uploader and the Super Admin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-media', 'feedback-media', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy feedback_media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'feedback-media' and split_part(name, '/', 1) = auth.uid()::text);

create policy feedback_media_read on storage.objects for select to authenticated
  using (bucket_id = 'feedback-media' and (split_part(name, '/', 1) = auth.uid()::text or private.is_admin()));
