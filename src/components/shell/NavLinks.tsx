"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import type { UserRole } from "@/lib/auth/currentUser";
import { navItems } from "./navItems";

export function NavLinks({ role, onNavigate }: { role: UserRole | null; onNavigate?: () => void }) {
  const t = useTranslations("Nav");
  const pathname = usePathname();

  return (
    <ul className="flex flex-col gap-0.5">
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
                  ? "flex h-10 items-center gap-2.5 rounded-lg bg-white px-3 text-sm font-semibold text-black shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                  : "flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm text-black/75 hover:bg-white/50 hover:text-black"
              }
            >
              <item.icon size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
              {t(item.key)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
