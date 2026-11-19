-- Outlet Equipment (Nelson, 2026-11-18): machines, grinders and hand brew kits
-- (brewers) are set up by the Super Admin without an outlet; each outlet's Admin
-- (or the Super Admin) picks which of them the outlet uses. One unit may be used
-- by several outlets. Daily calibrations take only the outlet's equipment.

-- 1. Which equipment each outlet uses ----------------------------------------

create table public.outlet_equipment (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete restrict,
  grinder_id uuid references public.grinders (id) on delete restrict,
  espresso_machine_id uuid references public.espresso_machines (id) on delete restrict,
  brewer_id uuid references public.brewers (id) on delete restrict,
  created_at timestamptz not null default now(),
  check (num_nonnulls(grinder_id, espresso_machine_id, brewer_id) = 1)
);
create unique index outlet_equipment_grinder_key
  on public.outlet_equipment (outlet_id, grinder_id) where grinder_id is not null;
create unique index outlet_equipment_machine_key
  on public.outlet_equipment (outlet_id, espresso_machine_id) where espresso_machine_id is not null;
create unique index outlet_equipment_brewer_key
  on public.outlet_equipment (outlet_id, brewer_id) where brewer_id is not null;
create trigger audit_outlet_equipment after insert or update or delete on public.outlet_equipment
  for each row execute function private.audit_row();

-- Super Admin: every outlet. Outlet Admin: their own outlets.
create function private.can_set_outlet_equipment(p_outlet_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin()
      or (private.is_outlet_admin() and private.outlets_within_mine(array[p_outlet_id]));
$$;
grant execute on function private.can_set_outlet_equipment(uuid) to authenticated;

alter table public.outlet_equipment enable row level security;
create policy outlet_equipment_select on public.outlet_equipment for select to authenticated using (true);
create policy outlet_equipment_insert on public.outlet_equipment for insert to authenticated
  with check (private.can_set_outlet_equipment(outlet_id));
create policy outlet_equipment_delete on public.outlet_equipment for delete to authenticated
  using (private.can_set_outlet_equipment(outlet_id));
grant select, insert, delete on public.outlet_equipment to authenticated;
revoke all on public.outlet_equipment from anon;
revoke update on public.outlet_equipment from authenticated;

-- 2. Today's assignments come from the equipment's outlet --------------------

insert into public.outlet_equipment (outlet_id, grinder_id) select outlet_id, id from public.grinders;
insert into public.outlet_equipment (outlet_id, espresso_machine_id) select outlet_id, id from public.espresso_machines;
insert into public.outlet_equipment (outlet_id, brewer_id) select outlet_id, id from public.brewers;

-- 3. Equipment checks use the outlet's list -----------------------------------

create function private.outlet_grinder_ok(p_outlet_id uuid, p_grinder_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.grinders g
                   join public.outlet_equipment e on e.grinder_id = g.id and e.outlet_id = p_outlet_id
                  where g.id = p_grinder_id and g.is_active);
$$;
create function private.outlet_machine_ok(p_outlet_id uuid, p_machine_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.espresso_machines m
                   join public.outlet_equipment e on e.espresso_machine_id = m.id and e.outlet_id = p_outlet_id
                  where m.id = p_machine_id and m.is_active);
$$;
create function private.outlet_brewer_ok(p_outlet_id uuid, p_brewer_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.brewers b
                   join public.outlet_equipment e on e.brewer_id = b.id and e.outlet_id = p_outlet_id
                  where b.id = p_brewer_id and b.is_active);
$$;
grant execute on function private.outlet_grinder_ok(uuid, uuid) to authenticated;
grant execute on function private.outlet_machine_ok(uuid, uuid) to authenticated;
grant execute on function private.outlet_brewer_ok(uuid, uuid) to authenticated;

create or replace function private.calibration_equipment_ok(
  p_outlet_id uuid, p_grinder_id uuid, p_machine_id uuid
) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.outlet_grinder_ok(p_outlet_id, p_grinder_id)
     and (p_machine_id is null or private.outlet_machine_ok(p_outlet_id, p_machine_id));
$$;

create or replace function private.filter_equipment_ok(p_outlet_id uuid, p_brewer_id uuid, p_grinder_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select private.outlet_brewer_ok(p_outlet_id, p_brewer_id)
     and private.outlet_grinder_ok(p_outlet_id, p_grinder_id);
$$;

create or replace function private.calibrations_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.materials
     where id = new.coffee_bean_material_id and is_coffee_bean and status = 'APPROVED') then
    raise exception 'Choose an approved coffee bean' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.purpose <> old.purpose then
    raise exception 'Daily or custom cannot change' using errcode = '23514';
  end if;

  if new.purpose = 'DAILY' then
    if tg_op = 'UPDATE' and (
         new.outlet_id <> old.outlet_id or new.business_date <> old.business_date
         or new.coffee_bean_material_id <> old.coffee_bean_material_id or new.grinder_id <> old.grinder_id) then
      raise exception 'Outlet, date, bean and grinder identify the record and cannot change'
        using errcode = '23514';
    end if;
    -- Checked when chosen; a machine later removed from the outlet or disabled keeps old records valid.
    if tg_op = 'INSERT' then
      if not private.calibration_equipment_ok(new.outlet_id, new.grinder_id, new.espresso_machine_id) then
        raise exception 'Choose a grinder and machine of this outlet' using errcode = '23514';
      end if;
    elsif new.espresso_machine_id is distinct from old.espresso_machine_id
          and new.espresso_machine_id is not null
          and not private.outlet_machine_ok(new.outlet_id, new.espresso_machine_id) then
      raise exception 'Choose a machine of this outlet' using errcode = '23514';
    end if;
  else
    if (tg_op = 'INSERT' or new.grinder_id is distinct from old.grinder_id)
       and not private.custom_equipment_ok('grinders', new.grinder_id) then
      raise exception 'Choose a grinder in use' using errcode = '23514';
    end if;
    if (tg_op = 'INSERT' or new.espresso_machine_id is distinct from old.espresso_machine_id)
       and not private.custom_equipment_ok('espresso_machines', new.espresso_machine_id) then
      raise exception 'Choose a machine in use' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- The drink rows are replaced after this update, so the history keeps the old ones.
    perform private.record_calibration_history(old.id, to_jsonb(old) || jsonb_build_object(
      'drinks', (select coalesce(jsonb_agg(to_jsonb(d) - 'id' - 'calibration_id'), '[]'::jsonb)
                   from public.calibration_drinks d where d.calibration_id = old.id)));
  end if;

  if private.is_api_caller() then
    if new.purpose = 'DAILY' then
      perform private.calibration_window_ok(new.outlet_id, new.business_date);
      if new.deleted_at is distinct from (case when tg_op = 'UPDATE' then old.deleted_at end)
         and not private.can_manage_outlet(new.outlet_id) then
        raise exception 'Only a Manager or Admin can delete or restore calibrations' using errcode = '42501';
      end if;
    end if;
    if new.deleted_at is not null and (tg_op = 'INSERT' or old.deleted_at is null) then
      new.deleted_by := auth.uid();
    end if;
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function private.filter_calibrations_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.materials
     where id = new.coffee_bean_material_id and is_coffee_bean and status = 'APPROVED') then
    raise exception 'Choose an approved coffee bean' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.purpose <> old.purpose then
    raise exception 'Daily or custom cannot change' using errcode = '23514';
  end if;

  if new.purpose = 'DAILY' then
    if tg_op = 'UPDATE' and (
         new.outlet_id <> old.outlet_id or new.business_date <> old.business_date
         or new.coffee_bean_material_id <> old.coffee_bean_material_id or new.brewer_id <> old.brewer_id) then
      raise exception 'Outlet, date, bean and brewer identify the record and cannot change' using errcode = '23514';
    end if;
    -- Checked when chosen; equipment later removed from the outlet or disabled keeps old records valid.
    if tg_op = 'INSERT' then
      if not private.filter_equipment_ok(new.outlet_id, new.brewer_id, new.grinder_id) then
        raise exception 'Choose a brewer and grinder of this outlet' using errcode = '23514';
      end if;
    elsif new.grinder_id <> old.grinder_id
          and not private.outlet_grinder_ok(new.outlet_id, new.grinder_id) then
      raise exception 'Choose a grinder of this outlet' using errcode = '23514';
    end if;
  else
    if (tg_op = 'INSERT' or new.brewer_id is distinct from old.brewer_id)
       and not private.custom_equipment_ok('brewers', new.brewer_id) then
      raise exception 'Choose a brewer in use' using errcode = '23514';
    end if;
    if (tg_op = 'INSERT' or new.grinder_id is distinct from old.grinder_id)
       and not private.custom_equipment_ok('grinders', new.grinder_id) then
      raise exception 'Choose a grinder in use' using errcode = '23514';
    end if;
  end if;

  if private.is_api_caller() then
    if new.purpose = 'DAILY' then
      perform private.calibration_window_ok(new.outlet_id, new.business_date);
      if new.deleted_at is distinct from (case when tg_op = 'UPDATE' then old.deleted_at end)
         and not private.can_manage_outlet(new.outlet_id) then
        raise exception 'Only a Manager or Admin can delete or restore calibrations' using errcode = '42501';
      end if;
    end if;
    if new.deleted_at is not null and (tg_op = 'INSERT' or old.deleted_at is null) then
      new.deleted_by := auth.uid();
    end if;
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

-- 4. Equipment no longer has an outlet; names are unique across the company ----

alter table public.grinders drop column outlet_id;
alter table public.espresso_machines drop column outlet_id;
alter table public.brewers drop column outlet_id;
alter table public.grinders add constraint grinders_name_key unique (name);
alter table public.espresso_machines add constraint espresso_machines_name_key unique (name);
alter table public.brewers add constraint brewers_name_key unique (name);
