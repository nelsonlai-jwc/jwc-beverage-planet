-- Malay (Bahasa Melayu) as a third language (Nelson, 2026-11-16).
-- Only adds: a new locale value and a Malay name for style / temp / strength options.

alter type public.app_locale add value if not exists 'ms';

-- Malay display name. Empty means the English name is shown.
alter table public.option_labels
  add column label_ms text check (label_ms is null or char_length(btrim(label_ms)) between 1 and 40);

update public.option_labels o set label_ms = m.label_ms
  from (values
    ('STYLE', 'COFFEE', 'Kopi'),
    ('STYLE', 'TEA', 'Teh'),
    ('STYLE', 'COCKTAIL', 'Koktel'),
    ('STYLE', 'MOCKTAIL', 'Moktel'),
    ('STYLE', 'PREP_MATERIAL', 'Bahan Sediaan'),
    ('STYLE', 'CHOCOLATE', 'Coklat'),
    ('TEMP', 'HOT', 'Panas'),
    ('TEMP', 'COLD', 'Sejuk'),
    ('TEMP', 'FROZEN', 'Ais Kisar')
  ) as m (option_group, value, label_ms)
 where o.option_group = m.option_group and o.value = m.value;

-- Strength is a number: same in every language.
update public.option_labels set label_ms = label_en where option_group = 'STRENGTH';
