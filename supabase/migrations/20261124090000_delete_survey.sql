-- Delete a survey with its invitees and answers. Allowed for the creator, the
-- Super Admin, and an outlet Admin of any of the survey's outlets.
create function public.delete_survey(p_survey_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_survey public.surveys;
begin
  select * into v_survey from public.surveys where id = p_survey_id;
  if not found then
    raise exception 'Survey not found' using errcode = 'P0002';
  end if;
  if not (v_survey.created_by = auth.uid()
          or private.is_admin()
          or (private.is_outlet_admin() and exists (
                select 1 from public.user_outlets uo
                 where uo.user_id = auth.uid()
                   and uo.outlet_id = any (coalesce(v_survey.outlet_ids, '{}'))))) then
    raise exception 'Only the creator or an Admin can delete this survey' using errcode = '42501';
  end if;

  delete from public.survey_responses where survey_id = p_survey_id;
  delete from public.surveys where id = p_survey_id;
end;
$$;
revoke all on function public.delete_survey(uuid) from public, anon;
grant execute on function public.delete_survey(uuid) to authenticated;
