-- Feedback reports: submit, privacy, Super Admin status and reply.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'barista@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local', 'TEST ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local', 'TEST MANAGER', 'MANAGER'),
  ('00000000-0000-0000-0000-00000000000c', 'barista@test.local', 'TEST BARISTA', 'BARISTA');
update public.profiles set is_super_admin = true where role = 'ADMIN';

set local role authenticated;

-- Barista submits a bug; status and reply are forced to their defaults.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
insert into public.feedback_reports (id, kind, title, description, page_url, device, photo_paths, status, admin_reply)
values ('00000000-0000-0000-0000-0000000000f1', 'BUG', 'Menu blank', 'Menu page shows nothing',
        '/en/menus', 'PHONE', array['00000000-0000-0000-0000-00000000000c/a.jpg'], 'DONE', 'sneaky');
do $$
begin
  if (select status || coalesce(admin_reply, '-') from public.feedback_reports
       where id = '00000000-0000-0000-0000-0000000000f1') <> 'NEW-' then
    raise exception 'new report must start as NEW with no reply';
  end if;
end;
$$;

-- Photos must be the submitter's own; more than 5 is refused.
do $$
begin
  begin
    insert into public.feedback_reports (kind, title, description, photo_paths)
    values ('BUG', 'x', 'y', array['00000000-0000-0000-0000-00000000000b/a.jpg']);
    raise exception 'someone else''s photo should be refused';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.feedback_reports (kind, title, description, photo_paths)
    values ('IDEA', 'x', 'y', array_fill('00000000-0000-0000-0000-00000000000c/a.jpg'::text, array[6]));
    raise exception 'more than 5 photos should be refused';
  exception when check_violation then
    null;
  end;
end;
$$;

-- Barista cannot change status.
update public.feedback_reports set status = 'DONE' where id = '00000000-0000-0000-0000-0000000000f1';
do $$
begin
  if (select status from public.feedback_reports where id = '00000000-0000-0000-0000-0000000000f1') <> 'NEW' then
    raise exception 'barista should not change status';
  end if;
end;
$$;

-- Manager submits an idea and cannot see the barista's report.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
insert into public.feedback_reports (kind, title, description) values ('IDEA', 'Dark mode', 'Please');
do $$
begin
  if (select count(*) from public.feedback_reports) <> 1 then
    raise exception 'manager should see only their own report';
  end if;
end;
$$;

-- Super Admin sees both, sets status and replies.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
begin
  if (select count(*) from public.feedback_reports) <> 2 then
    raise exception 'super admin should see all reports';
  end if;
end;
$$;
update public.feedback_reports set status = 'IN_PROGRESS', admin_reply = 'Fixing it'
 where id = '00000000-0000-0000-0000-0000000000f1';
do $$
begin
  if not exists (select 1 from public.feedback_reports
                  where id = '00000000-0000-0000-0000-0000000000f1' and status = 'IN_PROGRESS'
                    and admin_reply = 'Fixing it' and replied_at is not null
                    and replied_by = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'super admin status/reply not saved';
  end if;
  begin
    update public.feedback_reports set title = 'changed' where id = '00000000-0000-0000-0000-0000000000f1';
    raise exception 'title should not change';
  exception when check_violation then
    null;
  end;
end;
$$;

-- The barista reads the reply.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
begin
  if (select admin_reply from public.feedback_reports where id = '00000000-0000-0000-0000-0000000000f1') <> 'Fixing it' then
    raise exception 'submitter should read the reply';
  end if;
end;
$$;

rollback;
