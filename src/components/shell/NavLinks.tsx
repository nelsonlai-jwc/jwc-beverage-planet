"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import type { UserRole } from "@/lib/auth/currentUser";
import { navItems } from "./navItems";

export function NavLinks({ role, onNavigate }: { role: UserRole | null; onNavigate?: () => void }) {
  const t = useTranslations("Nav");
  const pathname = usePathname();

  return (
    <ul className="flex flex-col gap-1">
      {navItems.filter((item) => role && (item.roles as readonly UserRole[]).includes(role)).map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "flex min-h-11 items-center rounded-xl bg-black px-3.5 text-sm font-semibold text-white"
                  : "flex min-h-11 items-center rounded-xl px-3.5 text-sm hover:bg-black/10"
              }
            >
              {t(item.key)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
