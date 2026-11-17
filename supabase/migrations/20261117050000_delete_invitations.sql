-- Delete the leftover invitation records of one email (Revoked / Expired after Resend).
-- Accepted invitations are kept. A still-valid Pending invite must be revoked first.
-- Outlet Admins only delete invitations within their outlets (same scope as revoke).
create function public.delete_invitations(p_email text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_count integer;
begin
  if not (private.is_admin() or private.is_outlet_admin()) then
    raise exception 'Only an Admin can delete invitations' using errcode = '42501';
  end if;
  if exists (select 1 from public.invitations
              where email_normalized = v_email and status = 'PENDING' and expires_at > now()) then
    raise exception 'Revoke the pending invitation first' using errcode = '55000';
  end if;

  delete from public.invitations i
   where i.email_normalized = v_email
     and i.status <> 'ACCEPTED'
     and private.invitation_in_scope(i.id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.delete_invitations(text) from public, anon;
grant execute on function public.delete_invitations(text) to authenticated;
