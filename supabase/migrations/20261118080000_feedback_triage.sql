-- Feedback triage for the Claude Code workflow (Nelson, 2026-11-18):
-- short report numbers, statuses NEW -> ACCEPTED / REJECTED -> WITH_CLAUDE -> DONE,
-- one-tap reject reasons the submitter sees in their own language, and an
-- internal note + priority only the Super Admin sees.

-- Short number (#1, #2, ...) for referring to a report.
alter table public.feedback_reports add column number integer generated always as identity;
alter table public.feedback_reports add constraint feedback_reports_number_key unique (number);

-- New statuses. Old values map: PLANNED -> ACCEPTED, IN_PROGRESS -> WITH_CLAUDE, WONT_DO -> REJECTED.
alter table public.feedback_reports drop constraint feedback_reports_status_check;
update public.feedback_reports set status = case status
  when 'PLANNED' then 'ACCEPTED'
  when 'IN_PROGRESS' then 'WITH_CLAUDE'
  when 'WONT_DO' then 'REJECTED'
  else status end
 where status in ('PLANNED', 'IN_PROGRESS', 'WONT_DO');

-- Preset reasons (keys, shown translated) picked when a report is not taken up.
alter table public.feedback_reports
  add column reject_reasons text[] not null default '{}'
    check (cardinality(reject_reasons) <= 10
           and reject_reasons <@ array['WORKS_AS_DESIGNED', 'CANNOT_REPRODUCE', 'ALREADY_FIXED', 'NEED_DETAILS',
                                        'PERMISSION', 'DEVICE_NETWORK', 'DUPLICATE', 'ALREADY_EXISTS',
                                        'NOT_FIT_WORKFLOW', 'NOT_PRIORITY', 'COST_TOO_HIGH', 'AFFECTS_OTHERS',
                                        'POLICY']::text[]);

alter table public.feedback_reports add constraint feedback_reports_status_check
  check (status in ('NEW', 'ACCEPTED', 'REJECTED', 'WITH_CLAUDE', 'DONE'));
-- A rejected report always tells the submitter why: a preset reason or a reply.
alter table public.feedback_reports add constraint feedback_reports_reject_reason_check
  check (status <> 'REJECTED' or cardinality(reject_reasons) > 0 or admin_reply is not null);

-- Submitters cannot set reasons; after insert, reasons change with status and reply.
create or replace function private.feedback_reports_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_path text;
begin
  if tg_op = 'INSERT' then
    new.status := 'NEW';
    new.admin_reply := null;
    new.replied_at := null;
    new.replied_by := null;
    new.reject_reasons := '{}';
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
     or new.created_at is distinct from old.created_at
     or new.number is distinct from old.number then
    raise exception 'Only status and reply can change' using errcode = '23514';
  end if;
  -- Reasons belong to a rejection only.
  if new.status <> 'REJECTED' then
    new.reject_reasons := '{}';
  end if;
  if new.admin_reply is distinct from old.admin_reply then
    new.admin_reply := nullif(btrim(new.admin_reply), '');
    new.replied_at := case when new.admin_reply is null then null else now() end;
    new.replied_by := case when new.admin_reply is null then null else auth.uid() end;
  end if;
  return new;
end;
$$;

-- Internal triage (Super Admin only): note for Claude and priority.
create table public.feedback_triage (
  report_id uuid primary key references public.feedback_reports (id) on delete cascade,
  priority text check (priority in ('HIGH', 'MEDIUM', 'LOW')),
  note text check (char_length(note) <= 2000),
  updated_at timestamptz not null default now(),
  revision integer not null default 1
);
create trigger feedback_triage_touch before update on public.feedback_triage
  for each row execute function private.touch_row();
create trigger audit_feedback_triage after insert or update or delete on public.feedback_triage
  for each row execute function private.audit_row();

alter table public.feedback_triage enable row level security;
create policy feedback_triage_select on public.feedback_triage for select to authenticated
  using (private.is_admin());
create policy feedback_triage_insert on public.feedback_triage for insert to authenticated
  with check (private.is_admin());
create policy feedback_triage_update on public.feedback_triage for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
grant select, insert, update on public.feedback_triage to authenticated;
