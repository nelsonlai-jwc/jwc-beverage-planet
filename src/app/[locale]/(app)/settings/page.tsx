import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChangePasswordForm } from "@/components/settings/ChangePasswordForm";
import { ListValuesEditor, OptionLabelsEditor } from "@/components/settings/SettingsEditors";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { settingGroups } from "@/lib/settings/defaults";
import { getOptionLabels, type OptionGroup } from "@/lib/settings/options";
import { createClient } from "@/lib/supabase/server";

// Groups the Admin edits, and how (decided with Nelson 2026-10-28). The rest are fixed.
const OPTION_GROUP: Record<string, OptionGroup> = { beverageStyle: "STYLE", temp: "TEMP", strength: "STRENGTH" };

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Settings");
  const supabase = await createClient();
  const [user, labels, { data: types }, { data: outlets }] = await Promise.all([
    getCurrentUser(),
    getOptionLabels(),
    supabase.from("material_types").select("id, name, is_active").order("sort_order"),
    supabase.from("outlets").select("id, code, name, is_active").order("sort_order"),
  ]);
  const isAdmin = user?.role === "ADMIN";

  const optionItems = (group: OptionGroup) =>
    labels.filter((l) => l.group === group).map((l) => ({ value: l.value, en: l.en, zh: l.zh }));
  // Read-only view: the current names in the viewer's language.
  const shownValues = (key: string, fallback: readonly string[]): string[] => {
    if (key === "materialType" && types) return types.filter((x) => x.is_active).map((x) => x.name);
    if (key === "outlet" && outlets) return outlets.filter((x) => x.is_active).map((x) => x.name);
    const group = OPTION_GROUP[key];
    const items = group ? optionItems(group) : [];
    if (items.length) return items.map((i) => (locale === "zh-CN" ? i.zh : i.en));
    return fallback.map((value) => (t.has(`values.${value}`) ? t(`values.${value}`) : value));
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-[32px] font-normal">{t("title")}</h1>
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
            <section
              key={group.key}
              aria-labelledby={`setting-${group.key}`}
              className="flex flex-col gap-3 rounded-[20px] bg-white p-5 sm:p-6"
            >
              <div className="flex flex-col gap-1">
                <h2 id={`setting-${group.key}`} className="text-base font-semibold">
                  {t(`groups.${group.key}.label`)}
                </h2>
                <p className="text-[13px] text-[#3d3f3a]">
                  {isAdmin ? t(`groups.${group.key}.adminRule`) : t(`groups.${group.key}.rule`)}
                </p>
              </div>
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
            </section>
          );
        })}
      </div>
    </div>
  );
}
