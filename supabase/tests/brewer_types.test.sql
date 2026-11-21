-- Hand Brew Kit types: new types accepted, unknown type refused, 20 presets present.
-- Runs in one transaction and rolls back. Run with psql -v ON_ERROR_STOP=1.

begin;

do $$
begin
  if (select count(*) from public.brewers where brewer_type = 'POUR_OVER'
        and name in ('Hario V60 01', 'Hario V60 02', 'Origami Dripper S', 'Origami Dripper M')) <> 4 then
    raise exception 'Preset Pour Over Drippers missing';
  end if;
  if (select count(*) from public.brewers where name in (
        'Hario V60 01','Hario V60 02','Hario V60 03','Hario Mugen 02','Origami Dripper S','Origami Dripper M',
        'Kalita Wave 155','Kalita Wave 185','Kalita 102','Chemex 3-Cup','Chemex 6-Cup','April Brewer','Orea V4',
        'Kono Meimon','Timemore Crystal Eye B75','Cafec Flower Dripper Cup4','Cafec Deep 27','Fellow Stagg X',
        'Melitta 1x2','Blue Bottle Dripper')) <> 20 then
    raise exception 'Expected 20 preset kits';
  end if;
end $$;

insert into public.brewers (name, brewer_type) values
  ('Test Immersion', 'IMMERSION'), ('Test Siphon', 'SIPHON'),
  ('Test Cold Brew', 'COLD_BREW'), ('Test Other', 'OTHER'), ('Test Batch', 'BATCH');

do $$
begin
  begin
    insert into public.brewers (name, brewer_type) values ('Bad Type', 'ESPRESSO');
    raise exception 'Unknown brewer type was accepted';
  exception when check_violation then null;
  end;
end $$;

rollback;
