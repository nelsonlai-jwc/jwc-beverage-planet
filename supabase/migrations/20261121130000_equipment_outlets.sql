-- Equipment outlets (Nelson, 2026-11-21): each grinder, espresso machine and hand
-- brew kit picks its outlets in its own form: "All outlets" (also outlets added
-- later) or ticked one by one, like recipes. The Super Admin sets everything; an
-- outlet Admin ticks or unticks only their own outlets. Per-outlet ticks stay in
-- public.outlet_equipment, so today's assignments are kept.

alter table public.grinders add column all_outlets boolean not null default false;
alter table public.espresso_machines add column all_outlets boolean not null default false;
alter table public.brewers add column all_outlets boolean not null default false;

-- Daily calibration: "All outlets" equipment counts for every outlet.
create or replace function private.outlet_grinder_ok(p_outlet_id uuid, p_grinder_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.grinders g
                  where g.id = p_grinder_id and g.is_active
                    and (g.all_outlets or exists (select 1 from public.outlet_equipment e
                                                   where e.grinder_id = g.id and e.outlet_id = p_outlet_id)));
$$;
create or replace function private.outlet_machine_ok(p_outlet_id uuid, p_machine_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.espresso_machines m
                  where m.id = p_machine_id and m.is_active
                    and (m.all_outlets or exists (select 1 from public.outlet_equipment e
                                                   where e.espresso_machine_id = m.id and e.outlet_id = p_outlet_id)));
$$;
create or replace function private.outlet_brewer_ok(p_outlet_id uuid, p_brewer_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.brewers b
                  where b.id = p_brewer_id and b.is_active
                    and (b.all_outlets or exists (select 1 from public.outlet_equipment e
                                                   where e.brewer_id = b.id and e.outlet_id = p_outlet_id)));
$$;

-- Saves one item's outlets in one step. p_kind: GRINDER, MACHINE or BREWER.
-- Changing "All outlets" is Super Admin only; every outlet ticked or unticked must
-- be one the caller may set (private.can_set_outlet_equipment).
create function public.set_equipment_outlets(
  p_kind text, p_equipment_id uuid, p_all_outlets boolean, p_outlet_ids uuid[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_all boolean;
  v_current uuid[];
  v_wanted uuid[] := coalesce(p_outlet_ids, '{}');
  v_outlet uuid;
begin
  if p_kind = 'GRINDER' then
    select all_outlets into v_all from public.grinders where id = p_equipment_id;
    select coalesce(array_agg(outlet_id), '{}') into v_current from public.outlet_equipment where grinder_id = p_equipment_id;
  elsif p_kind = 'MACHINE' then
    select all_outlets into v_all from public.espresso_machines where id = p_equipment_id;
    select coalesce(array_agg(outlet_id), '{}') into v_current from public.outlet_equipment where espresso_machine_id = p_equipment_id;
  elsif p_kind = 'BREWER' then
    select all_outlets into v_all from public.brewers where id = p_equipment_id;
    select coalesce(array_agg(outlet_id), '{}') into v_current from public.outlet_equipment where brewer_id = p_equipment_id;
  else
    raise exception 'Unknown equipment kind' using errcode = '22023';
  end if;
  if v_all is null then
    raise exception 'Equipment not found' using errcode = 'P0002';
  end if;

  if p_all_outlets is distinct from v_all then
    if not private.is_admin() then
      raise exception 'Only the Super Admin can choose All outlets' using errcode = '42501';
    end if;
    if p_kind = 'GRINDER' then update public.grinders set all_outlets = p_all_outlets where id = p_equipment_id;
    elsif p_kind = 'MACHINE' then update public.espresso_machines set all_outlets = p_all_outlets where id = p_equipment_id;
    else update public.brewers set all_outlets = p_all_outlets where id = p_equipment_id;
    end if;
  end if;

  -- "All outlets" replaces the ticked outlets.
  if p_all_outlets then
    v_wanted := '{}';
  end if;

  foreach v_outlet in array v_current loop
    if not v_outlet = any (v_wanted) then
      if not private.can_set_outlet_equipment(v_outlet) then
        raise exception 'Not allowed for this outlet' using errcode = '42501';
      end if;
      delete from public.outlet_equipment
       where outlet_id = v_outlet
         and (case p_kind when 'GRINDER' then grinder_id when 'MACHINE' then espresso_machine_id else brewer_id end) = p_equipment_id;
    end if;
  end loop;

  foreach v_outlet in array v_wanted loop
    if not v_outlet = any (v_current) then
      if not private.can_set_outlet_equipment(v_outlet) then
        raise exception 'Not allowed for this outlet' using errcode = '42501';
      end if;
      insert into public.outlet_equipment (outlet_id, grinder_id, espresso_machine_id, brewer_id)
      values (v_outlet,
              case when p_kind = 'GRINDER' then p_equipment_id end,
              case when p_kind = 'MACHINE' then p_equipment_id end,
              case when p_kind = 'BREWER' then p_equipment_id end)
      on conflict do nothing;
    end if;
  end loop;
end;
$$;
revoke all on function public.set_equipment_outlets(text, uuid, boolean, uuid[]) from public, anon;
grant execute on function public.set_equipment_outlets(text, uuid, boolean, uuid[]) to authenticated;
