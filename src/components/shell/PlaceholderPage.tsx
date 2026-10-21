import { useTranslations } from "next-intl";
import type { NavKey } from "./navItems";

export function PlaceholderPage({ navKey }: { navKey: NavKey }) {
  const nav = useTranslations("Nav");
  const t = useTranslations("Placeholder");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-serif text-[32px] font-normal">{nav(navKey)}</h1>
      <p className="rounded-[20px] bg-white p-6 text-sm text-[#3d3f3a]">
        {t("comingSoon")}
      </p>
    </div>
  );
}
