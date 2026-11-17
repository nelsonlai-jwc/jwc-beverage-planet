"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { navItems, type NavItem, type NavViewer } from "./navItems";

const row = "flex h-9 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-sm";
const rowActive = "bg-white/70 font-medium text-black";
const rowIdle = "text-black/70 hover:bg-white/40 hover:text-black";

/**
 * Main menu: 36px rows with icons; Raw Material, Recipes and Reports open their sub-pages.
 * `collapsed` shows icons only (desktop sidebar folded), names as tooltips.
 */
export function NavLinks({
  viewer,
  collapsed = false,
  onNavigate,
}: {
  viewer: NavViewer | null;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");

  if (!viewer) return null;
  const items = navItems.filter((item) => item.roles.includes(viewer.displayRole));

  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const inSection = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const children = (item.children ?? []).filter((child) => !child.show || child.show(viewer));
        return (
          <li key={item.href} className={item.dividerBefore ? "mt-2 border-t border-black/15 pt-2" : undefined}>
            {collapsed || children.length === 0 ? (
              <Link
                href={item.href}
                onClick={onNavigate}
                title={collapsed ? t(item.key) : undefined}
                aria-label={collapsed ? t(item.key) : undefined}
                aria-current={inSection ? "page" : undefined}
                className={`${row} ${collapsed ? "justify-center px-0" : ""} ${inSection ? rowActive : rowIdle}`}
              >
                <item.icon size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
                {!collapsed && <span className="truncate">{t(item.key)}</span>}
              </Link>
            ) : (
              <NavGroup
                item={item}
                label={t(item.key)}
                inSection={inSection}
                pathname={pathname}
                tab={tab}
                childItems={children}
                onNavigate={onNavigate}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function NavGroup({
  item,
  label,
  inSection,
  pathname,
  tab,
  childItems,
  onNavigate,
}: {
  item: NavItem;
  label: string;
  inSection: boolean;
  pathname: string;
  tab: string | null;
  childItems: NonNullable<NavItem["children"]>;
  onNavigate?: () => void;
}) {
  const tRoot = useTranslations();
  const tShell = useTranslations("Shell");
  // Open while inside the section; the chevron opens/closes it by hand.
  const [toggled, setToggled] = useState<{ open: boolean; at: string } | null>(null);
  const open = toggled && toggled.at === pathname ? toggled.open : inSection;
  const activeChild = childItems.find((child) => child.match(pathname, tab));
  const listId = `nav-${item.key}`;

  return (
    <>
      <div className="flex items-center gap-0.5">
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={inSection && !activeChild ? "page" : undefined}
          className={`${row} flex-1 ${inSection && !activeChild ? rowActive : inSection ? "font-medium text-black hover:bg-white/40" : rowIdle}`}
        >
          <item.icon size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
          <span className="truncate">{label}</span>
        </Link>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={tShell("toggleSection", { name: label })}
          onClick={() => setToggled({ open: !open, at: pathname })}
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-black/60 hover:bg-white/40 hover:text-black"
        >
          <ChevronDown
            size={16}
            strokeWidth={1.75}
            aria-hidden
            className={`transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </button>
      </div>
      {open && (
        <ul id={listId} className="mt-0.5 ml-[17px] flex flex-col gap-0.5 border-l border-black/15 pl-2">
          {childItems.map((child) => {
            const active = child === activeChild;
            return (
              <li key={child.href}>
                <Link
                  href={child.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`${row} h-8 ${active ? rowActive : rowIdle}`}
                >
                  <span className="truncate">{tRoot(child.label)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
