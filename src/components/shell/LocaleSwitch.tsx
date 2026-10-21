"use client";

import { useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const localeLabels: Record<string, string> = {
  en: "EN",
  "zh-CN": "简体中文",
};

export function LocaleSwitch() {
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <nav aria-label="Language" className="flex gap-1">
      {routing.locales.map((code) => (
        <Link
          key={code}
          href={pathname}
          locale={code}
          aria-current={code === locale ? "true" : undefined}
          className={
            code === locale
              ? "rounded-full bg-black px-3 py-1.5 text-sm font-semibold text-white"
              : "rounded-full px-3 py-1.5 text-sm hover:bg-black/10"
          }
        >
          {localeLabels[code]}
        </Link>
      ))}
    </nav>
  );
}
