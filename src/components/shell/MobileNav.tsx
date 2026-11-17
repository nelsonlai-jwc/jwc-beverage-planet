"use client";

import { useTranslations } from "next-intl";
import { Menu, X } from "lucide-react";
import { Suspense, useState } from "react";
import { NavLinks } from "./NavLinks";
import type { NavViewer } from "./navItems";

export function MobileNav({ viewer }: { viewer: NavViewer | null }) {
  const t = useTranslations("Shell");
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black bg-white px-4 text-sm font-semibold hover:bg-black/5"
      >
        {open ? <X size={16} strokeWidth={2} aria-hidden /> : <Menu size={16} strokeWidth={2} aria-hidden />}
        {open ? t("closeMenu") : t("menu")}
      </button>
      {open && (
        <nav
          id="mobile-nav"
          aria-label={t("mainNav")}
          className="absolute inset-x-0 top-full z-20 border-b border-black/15 bg-brand-base px-4 pt-2 pb-4 shadow-lg"
        >
          <Suspense fallback={null}>
            <NavLinks viewer={viewer} onNavigate={() => setOpen(false)} />
          </Suspense>
        </nav>
      )}
    </div>
  );
}
