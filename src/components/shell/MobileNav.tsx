"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { NavLinks } from "./NavLinks";

export function MobileNav() {
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
          <NavLinks onNavigate={() => setOpen(false)} />
        </nav>
      )}
    </div>
  );
}
