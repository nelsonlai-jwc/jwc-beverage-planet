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
    <div className="contents lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((value) => !value)}
        className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-black bg-white px-4 text-sm font-semibold hover:bg-black/5"
      >
        {open ? <X size={16} strokeWidth={2} aria-hidden /> : <Menu size={16} strokeWidth={2} aria-hidden />}
        {/* Text in its own span: Chrome page translation swaps bare text nodes, which crashed the icon swap. */}
        <span>{open ? t("closeMenu") : t("menu")}</span>
      </button>
      {open && (
        <nav
          id="mobile-nav"
          aria-label={t("mainNav")}
          className="order-1 w-full border-t border-black/15 pt-2 pb-1 lg:hidden"
        >
          <Suspense fallback={null}>
            <NavLinks viewer={viewer} onNavigate={() => setOpen(false)} />
          </Suspense>
        </nav>
      )}
    </div>
  );
}
