"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { UserRole } from "@/lib/auth/currentUser";
import { LogoutButton } from "./LogoutButton";
import { NavLinks } from "./NavLinks";

export function MobileNav({ role }: { role: UserRole | null }) {
  const t = useTranslations("Shell");
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 items-center gap-2 rounded-xl border-[1.5px] border-black bg-white px-3.5 text-sm font-semibold"
      >
        <span aria-hidden="true" className="flex w-4 flex-col gap-[3px]">
          <span className="h-0.5 bg-black" />
          <span className="h-0.5 bg-black" />
          <span className="h-0.5 bg-black" />
        </span>
        {open ? t("closeMenu") : t("menu")}
      </button>
      {open && (
        <nav
          id="mobile-nav"
          aria-label={t("mainNav")}
          className="absolute inset-x-0 top-full z-20 border-b border-black/15 bg-brand-base px-4 pt-2 pb-4 shadow-lg"
        >
          <NavLinks role={role} onNavigate={() => setOpen(false)} />
          <LogoutButton className="mt-1 flex min-h-11 w-full items-center rounded-xl px-3.5 text-sm hover:bg-black/10 disabled:opacity-50" />
        </nav>
      )}
    </div>
  );
}
