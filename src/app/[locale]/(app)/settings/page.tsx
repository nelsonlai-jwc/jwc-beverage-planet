import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { settingGroups } from "@/lib/settings/defaults";

export default function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("Settings");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[32px] font-normal">{t("title")}</h1>
        <p className="text-sm text-[#3d3f3a]">{t("readOnlyNote")}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {settingGroups.map((group) => (
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
                {t(`groups.${group.key}.rule`)}
              </p>
            </div>
            <ul className="flex flex-wrap gap-2">
              {group.values.map((value) => (
                <li
                  key={value}
                  className="rounded-full border-[1.5px] border-black px-3 py-1 text-sm"
                >
                  {t.has(`values.${value}`) ? t(`values.${value}`) : value}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
