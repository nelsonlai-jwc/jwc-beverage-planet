"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { LogoutButton } from "./LogoutButton";

const localeLabels: Record<string, string> = {
  en: "EN",
  "zh-CN": "简体中文",
  ms: "Bahasa Melayu",
};

/** Element id the page's "AI translated" note is portalled into (see TranslationNote). */
export const TRANSLATION_SLOT_ID = "bottom-bar-translation";

/** Black bar fixed to the bottom of every signed-in page: translation note left, language + log out right. */
export function BottomBar() {
  const t = useTranslations("Shell");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 bg-black pb-[env(safe-area-inset-bottom)] text-white print:hidden">
      {/* Wraps to two rows on a narrow phone when the translation note does not fit beside the controls. */}
      <div className="relative flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 md:px-8">
        <div id={TRANSLATION_SLOT_ID} className="flex items-center" />
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center">
            <span className="sr-only">{t("language")}</span>
            <select
              value={locale}
              onChange={(e) =>
                router.replace(pathname, { locale: e.target.value })
              }
              className="h-[23px] rounded-full border-[1.5px] border-white/40 bg-black py-0 pr-1.5 pl-2.5 text-xs leading-none font-semibold text-white"
            >
              {routing.locales.map((code) => (
                <option key={code} value={code}>
                  {localeLabels[code]}
                </option>
              ))}
            </select>
          </label>
          <LogoutButton className="shrink-0 rounded-full px-3 py-1.5 text-sm hover:bg-white/15 disabled:opacity-50" />
        </div>
      </div>
    </div>
  );
}
