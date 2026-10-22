import { useTranslations } from "next-intl";
import type { CurrentUser } from "@/lib/auth/currentUser";
import { LocaleSwitch } from "./LocaleSwitch";
import { Logo } from "./Logo";
import { MobileNav } from "./MobileNav";
import { NavLinks } from "./NavLinks";

export function AppShell({
  user,
  children,
}: {
  user: CurrentUser | null;
  children: React.ReactNode;
}) {
  const t = useTranslations("Shell");
  const outletScope =
    user?.role === "ADMIN"
      ? t("allOutlets")
      : user?.outlets.map((outlet) => outlet.name).join(", ") || "—";

  return (
    <div className="min-h-dvh bg-brand-base text-black md:flex">
      <aside className="sticky top-0 hidden h-dvh print:hidden w-60 shrink-0 flex-col gap-6 border-r border-black/15 px-4 py-6 md:flex">
        <Logo className="px-3.5" />
        <nav aria-label={t("mainNav")}>
          <NavLinks />
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative flex flex-wrap print:hidden items-center gap-x-4 gap-y-2 border-b border-black/15 px-4 py-3 md:px-8">
          <Logo className="md:hidden" />
          <dl className="order-last flex w-full flex-wrap gap-x-4 gap-y-1 text-sm md:order-none md:w-auto">
            <div className="flex gap-1.5">
              <dt className="text-[#3d3f3a]">{t("role")}</dt>
              <dd className="font-semibold">{user?.role ?? "—"}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-[#3d3f3a]">{t("outletScope")}</dt>
              <dd className="font-semibold">{outletScope}</dd>
            </div>
          </dl>
          <div className="ml-auto flex items-center gap-2">
            <LocaleSwitch />
            <MobileNav />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
