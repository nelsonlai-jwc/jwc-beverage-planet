import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import { EquipmentEditor, type EquipmentItem } from "@/components/settings/EquipmentEditor";
import { Chevron, ListValuesEditor, OptionLabelsEditor } from "@/components/settings/SettingsEditors";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { settingGroups } from "@/lib/settings/defaults";
import { getOptionLabels, optionName, type OptionGroup } from "@/lib/settings/options";
import { createClient } from "@/lib/supabase/server";

// Groups the Admin edits, and how (decided with Nelson 2026-10-28). The rest are fixed.
const OPTION_GROUP: Record<string, OptionGroup> = { beverageStyle: "STYLE", temp: "TEMP" };

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Settings");
  const supabase = await createClient();
  const [user, labels, { data: types }, { data: outlets }, { data: grinders }, { data: machines }, { data: brewers }] = await Promise.all([
    getCurrentUser(),
    getOptionLabels(),
    supabase.from("material_types").select("id, name, is_active").order("sort_order"),
    supabase.from("outlets").select("id, code, name, is_active").order("sort_order"),
    supabase.from("grinders").select("*").order("name"),
    supabase.from("espresso_machines").select("*").order("name"),
    supabase.from("brewers").select("*").order("name"),
  ]);
  const isAdmin = user?.role === "ADMIN";

  const optionItems = (group: OptionGroup) =>
    labels.filter((l) => l.group === group).map((l) => ({ value: l.value, en: l.en, zh: l.zh, ms: l.ms }));
  // Read-only view: the current names in the viewer's language.
  const shownValues = (key: string, fallback: readonly string[]): string[] => {
    if (key === "materialType" && types) return types.filter((x) => x.is_active).map((x) => x.name);
    if (key === "outlet" && outlets) return outlets.filter((x) => x.is_active).map((x) => x.name);
    const group = OPTION_GROUP[key];
    const items = group ? optionItems(group) : [];
    if (items.length) return items.map((i) => optionName(i, locale));
    return fallback.map((value) => (t.has(`values.${value}`) ? t(`values.${value}`) : value));
  };

  const grinderItems: EquipmentItem[] = (grinders ?? []).map((g) => ({
    id: g.id,
    outletId: g.outlet_id,
    name: g.name,
    brand: g.brand,
    model: g.model,
    serialNumber: g.serial_number,
    notes: g.notes,
    active: g.is_active,
    burrType: g.burr_type,
    burrSizeMm: g.burr_size_mm,
    scaleType: g.scale_type,
    scaleMin: g.scale_min,
    scaleMax: g.scale_max,
  }));
  const machineItems: EquipmentItem[] = (machines ?? []).map((m) => ({
    id: m.id,
    outletId: m.outlet_id,
    name: m.name,
    brand: m.brand,
    model: m.model,
    serialNumber: m.serial_number,
    notes: m.notes,
    active: m.is_active,
    groupCount: m.group_count,
    defaultWaterTempC: m.default_water_temp_c,
    defaultPressureBar: m.default_pressure_bar,
  }));
  const brewerItems: EquipmentItem[] = (brewers ?? []).map((b) => ({
    id: b.id,
    outletId: b.outlet_id,
    name: b.name,
    brand: b.brand,
    model: b.model,
    serialNumber: b.serial_number,
    notes: b.notes,
    active: b.is_active,
    brewerType: b.brewer_type,
  }));
  const outletOptions = (outlets ?? []).filter((o) => o.is_active).map((o) => ({ id: o.id, name: o.name }));
  const outletName = new Map((outlets ?? []).map((o) => [o.id, o.name]));
  const equipmentCards = [
    { key: "grinders", kind: "GRINDER" as const, items: grinderItems },
    { key: "machines", kind: "MACHINE" as const, items: machineItems },
    { key: "brewers", kind: "BREWER" as const, items: brewerItems },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-[26px] font-normal leading-tight md:text-[28px]">{t("title")}</h1>
      <ChangePasswordForm />
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold">{t("systemValues")}</h2>
        <p className="text-sm text-[#3d3f3a]">{isAdmin ? t("adminNote") : t("readOnlyNote")}</p>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {settingGroups.map((group) => {
          const editable =
            isAdmin && (group.key === "materialType" || group.key === "outlet" || group.key in OPTION_GROUP);
          return (
            // Collapsed by default: tap the title to open the card.
            <details
              key={group.key}
              aria-labelledby={`setting-${group.key}`}
              className="group flex flex-col rounded-[20px] bg-white p-5 sm:p-6 [&[open]>summary]:mb-3"
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
                <div className="flex flex-col gap-1">
                  <h2 id={`setting-${group.key}`} className="text-base font-semibold">
                    {t(`groups.${group.key}.label`)}
                  </h2>
                  <p className="text-[13px] text-[#3d3f3a]">
                    {isAdmin ? t(`groups.${group.key}.adminRule`) : t(`groups.${group.key}.rule`)}
                  </p>
                </div>
                <Chevron className="mt-1 shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              {editable && group.key === "materialType" ? (
                <ListValuesEditor
                  group="MATERIAL_TYPE"
                  items={(types ?? []).map((x) => ({ id: x.id, name: x.name, active: x.is_active }))}
                />
              ) : editable && group.key === "outlet" ? (
                <ListValuesEditor
                  group="OUTLET"
                  items={(outlets ?? []).map((x) => ({ id: x.id, name: x.name, code: x.code, active: x.is_active }))}
                />
              ) : editable ? (
                <OptionLabelsEditor group={OPTION_GROUP[group.key]} items={optionItems(OPTION_GROUP[group.key])} />
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {shownValues(group.key, group.values).map((value) => (
                    <li key={value} className="rounded-full border-[1.5px] border-black px-3 py-1 text-sm">
                      {value}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          );
        })}
        {equipmentCards.map((card) => (
          <details
            key={card.key}
            aria-labelledby={`setting-${card.key}`}
            className="group flex flex-col rounded-[20px] bg-white p-5 sm:p-6 [&[open]>summary]:mb-3"
          >
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
              <div className="flex flex-col gap-1">
                <h2 id={`setting-${card.key}`} className="text-base font-semibold">
                  {t(`groups.${card.key}.label`)}
                </h2>
                <p className="text-[13px] text-[#3d3f3a]">
                  {isAdmin ? t(`groups.${card.key}.adminRule`) : t(`groups.${card.key}.rule`)}
                </p>
              </div>
              <Chevron className="mt-1 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            {isAdmin ? (
              <EquipmentEditor kind={card.kind} items={card.items} outlets={outletOptions} />
            ) : (
              <ul className="flex flex-wrap gap-2">
                {card.items
                  .filter((item) => item.active)
                  .map((item) => (
                    <li key={item.id} className="rounded-full border-[1.5px] border-black px-3 py-1 text-sm">
                      {item.name} · {outletName.get(item.outletId) ?? "—"}
                    </li>
                  ))}
              </ul>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}
