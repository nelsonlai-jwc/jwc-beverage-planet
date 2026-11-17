"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
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
  const rowRef = useRef<HTMLDivElement>(null);
  useFitOneRow(rowRef);

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 bg-black pb-[env(safe-area-inset-bottom)] text-white print:hidden">
      {/* Always one row: useFitOneRow shrinks the font (12px down to 8px) until everything fits. */}
      <div
        ref={rowRef}
        className="relative flex min-h-12 items-center gap-[0.75em] px-4 py-2 text-[12px] leading-[1.35] md:px-8"
      >
        <div id={TRANSLATION_SLOT_ID} className="flex min-w-0 items-center" />
        <div className="ml-auto flex shrink-0 items-center gap-[0.5em]">
          {/* Shows only the current language (so it stays narrow); the native select over it opens the list. */}
          <label className="relative inline-flex items-center gap-[0.4em] rounded-full border-[1.5px] border-white/40 px-[0.8em] py-0.5 font-semibold whitespace-nowrap">
            <span className="sr-only">{t("language")}</span>
            <span aria-hidden="true">{localeLabels[locale]}</span>
            <span aria-hidden="true" className="text-[0.8em]">
              ▼
            </span>
            <select
              value={locale}
              onChange={(e) =>
                router.replace(pathname, { locale: e.target.value })
              }
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              {routing.locales.map((code) => (
                <option key={code} value={code}>
                  {localeLabels[code]}
                </option>
              ))}
            </select>
          </label>
          <LogoutButton className="shrink-0 rounded-full px-[0.6em] py-0.5 whitespace-nowrap hover:bg-white/15 disabled:opacity-50" />
        </div>
      </div>
    </div>
  );
}

const MAX_FONT = 12;
const MIN_FONT = 8;

/**
 * Keeps the bar on one row: when the content is wider than the screen, the bar's font size
 * (every item is sized in em) is lowered until it fits. Only below 8px does "Correct translation" cut off with "…".
 */
function useFitOneRow(rowRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const fit = () => {
      let size = MAX_FONT;
      row.style.fontSize = `${size}px`;
      for (let i = 0; i < 4; i++) {
        // Text that does not fit: the overflow of the truncating link plus anything past the row's edge.
        const link = row.querySelector<HTMLElement>(
          `#${TRANSLATION_SLOT_ID} button`,
        );
        const overflow =
          (link ? link.scrollWidth - link.clientWidth : 0) +
          (row.scrollWidth - row.clientWidth);
        if (overflow <= 0 || size <= MIN_FONT) break;
        const width = row.clientWidth;
        size = Math.max(
          MIN_FONT,
          Math.floor(size * (width / (width + overflow)) * 4) / 4,
        );
        row.style.fontSize = `${size}px`;
      }
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(row);
    // The translation note is portalled in after the page renders, and its text changes with the language.
    const mutation = new MutationObserver(fit);
    mutation.observe(row, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, [rowRef]);
}
