-- AI translations of user-entered content. Runs in one transaction and rolls back.
-- Run with psql -v ON_ERROR_STOP=1.

begin;

alter table auth.users disable trigger on_auth_user_created;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local', 'TEST ADMIN', 'ADMIN'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.local', 'TEST MANAGER', 'MANAGER');
insert into public.menu_categories (outlet_id, name, created_by)
  select id, '咖啡', '00000000-0000-0000-0000-00000000000a' from public.outlets where code = 'JB-BROOOS';

-- The test Admin is the Super Admin (global Admin rights).
update public.profiles set is_super_admin = true where role = 'ADMIN';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
begin
  -- Stored only for texts that are current content; never for made-up text.
  assert public.save_ai_translations(
    '[{"source": "咖啡", "en": "Coffee", "zh": "咖啡", "ms": "Kopi"},
      {"source": "not in the system", "en": "x", "zh": "x", "ms": "x"}]'::jsonb) = 1, 'one stored';
  assert (select ms from public.content_translations where source_hash = md5('咖啡')) = 'Kopi', 'readable';
  -- Direct writes are not allowed.
  begin
    update public.content_translations set ms = 'Teh';
    raise exception 'direct update should fail';
  exception when insufficient_privilege then
    null;
  end;
  -- Only an Admin corrects by hand.
  begin
    perform public.save_manual_translation('咖啡', 'Coffee', '咖啡', 'Kopi O');
    raise exception 'manager should not correct';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
begin
  perform public.save_manual_translation('咖啡', 'Coffee', '咖啡', 'Kopi O');
  -- A later AI answer does not replace the correction.
  perform public.save_ai_translations('[{"source": "咖啡", "en": "Coffee", "zh": "咖啡", "ms": "Kopi"}]'::jsonb);
  assert (select ms || is_manual::text from public.content_translations where source_hash = md5('咖啡')) = 'Kopi Otrue',
    'manual kept';
end;
$$;

rollback;
