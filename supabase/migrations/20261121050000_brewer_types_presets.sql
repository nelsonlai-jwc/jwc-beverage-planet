-- Hand Brew Kit types and 20 preset kits (Nelson, 2026-11-21).
-- Keeps POUR_OVER and BATCH, adds IMMERSION, SIPHON, COLD_BREW and OTHER.
-- Presets are active Pour Over Drippers with no outlet; outlet Admins tick them in Outlet Equipment.

alter table public.brewers drop constraint brewers_brewer_type_check;
alter table public.brewers add constraint brewers_brewer_type_check
  check (brewer_type in ('POUR_OVER', 'BATCH', 'IMMERSION', 'SIPHON', 'COLD_BREW', 'OTHER'));

insert into public.brewers (name, brand, model, brewer_type) values
  ('Hario V60 01', 'Hario', 'V60 01', 'POUR_OVER'),
  ('Hario V60 02', 'Hario', 'V60 02', 'POUR_OVER'),
  ('Hario V60 03', 'Hario', 'V60 03', 'POUR_OVER'),
  ('Hario Mugen 02', 'Hario', 'Mugen 02', 'POUR_OVER'),
  ('Origami Dripper S', 'Origami', 'Dripper S', 'POUR_OVER'),
  ('Origami Dripper M', 'Origami', 'Dripper M', 'POUR_OVER'),
  ('Kalita Wave 155', 'Kalita', 'Wave 155', 'POUR_OVER'),
  ('Kalita Wave 185', 'Kalita', 'Wave 185', 'POUR_OVER'),
  ('Kalita 102', 'Kalita', '102', 'POUR_OVER'),
  ('Chemex 3-Cup', 'Chemex', '3-Cup', 'POUR_OVER'),
  ('Chemex 6-Cup', 'Chemex', '6-Cup', 'POUR_OVER'),
  ('April Brewer', 'April', 'Brewer', 'POUR_OVER'),
  ('Orea V4', 'Orea', 'V4', 'POUR_OVER'),
  ('Kono Meimon', 'Kono', 'Meimon', 'POUR_OVER'),
  ('Timemore Crystal Eye B75', 'Timemore', 'Crystal Eye B75', 'POUR_OVER'),
  ('Cafec Flower Dripper Cup4', 'Cafec', 'Flower Dripper Cup4', 'POUR_OVER'),
  ('Cafec Deep 27', 'Cafec', 'Deep 27', 'POUR_OVER'),
  ('Fellow Stagg X', 'Fellow', 'Stagg X', 'POUR_OVER'),
  ('Melitta 1x2', 'Melitta', '1x2', 'POUR_OVER'),
  ('Blue Bottle Dripper', 'Blue Bottle', 'Dripper', 'POUR_OVER')
on conflict (name) do nothing;
