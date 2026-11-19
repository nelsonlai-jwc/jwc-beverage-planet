import { useTranslations } from "next-intl";
import type { CurrentUser } from "@/lib/auth/currentUser";
import { Toaster } from "@/components/ui/toast";
import { BottomBar } from "./BottomBar";
import { Logo } from "./Logo";
import { MobileNav } from "./MobileNav";
import type { NavViewer } from "./navItems";
import { Sidebar } from "./Sidebar";

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
  const viewer: NavViewer | null = user
    ? { displayRole: user.displayRole, role: user.role, outletAdmin: user.outletAdmin }
    : null;

  return (
    <div className="min-h-dvh bg-brand-base text-black lg:flex">
      <Sidebar viewer={viewer} label={t("mainNav")} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative flex flex-wrap print:hidden items-center gap-x-4 gap-y-2 border-b border-black/15 px-4 py-3 md:px-8">
          <Logo className="lg:hidden" />
          <dl className="order-last flex w-full flex-wrap gap-x-4 gap-y-1 text-sm lg:order-none lg:w-auto">
            <div className="flex gap-1.5">
              <dt className="text-[#3d3f3a]">{t("role")}</dt>
              <dd className="font-semibold">
                {user ? t(`roles.${user.displayRole}`) : "—"}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-[#3d3f3a]">{t("outletScope")}</dt>
              <dd className="font-semibold">{outletScope}</dd>
            </div>
          </dl>
          <MobileNav viewer={viewer} />
        </header>
        <main className="flex-1 px-4 pt-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:px-8 md:pt-8 md:pb-[calc(5rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto w-full max-w-[1280px]">{children}</div>
        </main>
      </div>
      <Toaster />
      <BottomBar />
    </div>
  );
}
