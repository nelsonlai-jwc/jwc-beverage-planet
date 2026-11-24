-- Super Admins have no outlet rows, so they never showed in the outlet-survey
-- staff list and could not be invited. List and allow active Super Admins for
-- every outlet.

create or replace function public.survey_outlet_people(p_outlet_id uuid)
returns table (id uuid, full_name text, role public.user_role)
language sql stable security definer set search_path = '' as $$
  select p.id, coalesce(nullif(p.full_name, ''), p.email), p.role
    from public.profiles p
   where p.status = 'ACTIVE'
     and private.can_manage_outlet(p_outlet_id)
     and (p.is_super_admin
          or exists (select 1 from public.user_outlets uo
                      where uo.user_id = p.id and uo.outlet_id = p_outlet_id))
   order by 2;
$$;

create or replace function private.survey_invitees_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.surveys s
      join public.profiles p on p.id = new.user_id and p.status = 'ACTIVE'
     where s.id = new.survey_id and s.audience = 'OUTLET'
       and (p.is_super_admin
            or exists (select 1 from public.user_outlets uo
                        where uo.user_id = new.user_id and uo.outlet_id = any (s.outlet_ids)))) then
    raise exception 'Invite active staff of this outlet' using errcode = '23514';
  end if;
  return new;
end;
$$;
