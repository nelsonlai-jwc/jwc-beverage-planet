-- Sign-up inserts into auth.users run as supabase_auth_admin, which has no
-- access to schema private. The deferred outlet-shape check fired from
-- handle_new_auth_user then failed at commit, so run it as its owner.
alter function private.user_outlets_shape_trigger() security definer set search_path = '';
