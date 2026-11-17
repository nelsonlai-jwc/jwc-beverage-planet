"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "./Logo";
import { NavLinks } from "./NavLinks";
import type { NavViewer } from "./navItems";

const MIN_WIDTH = 200;
const MAX_WIDTH = 320;
const DEFAULT_WIDTH = 240;
const COLLAPSED_WIDTH = 60;
const STORAGE_KEY = "sidebar";

function readSaved(): { width: number; collapsed: boolean } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved && typeof saved.width === "number") {
      return {
        width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, saved.width)),
        collapsed: saved.collapsed === true,
      };
    }
  } catch {
    // Storage blocked: use the defaults.
  }
  return null;
}

/**
 * Desktop sidebar (lg and up): its own scroll, drag the right edge to resize (200–320px),
 * or fold it to icons. Width and folded state are remembered in this browser.
 */
export function Sidebar({ viewer, label }: { viewer: NavViewer | null; label: string }) {
  const t = useTranslations("Shell");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const saved = readSaved();
    if (saved) {
      setWidth(saved.width);
      setCollapsed(saved.collapsed);
    }
  }, []);

  const save = useCallback((next: { width: number; collapsed: boolean }) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Not remembered; still works for this page view.
    }
  }, []);

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (collapsed) return;
    event.preventDefault();
    const left = asideRef.current?.getBoundingClientRect().left ?? 0;
    let latest = width;
    setDragging(true);
    const move = (e: PointerEvent) => {
      latest = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX - left)));
      setWidth(latest);
    };
    const up = () => {
      setDragging(false);
      save({ width: latest, collapsed: false });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onHandleKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + (event.key === "ArrowRight" ? 16 : -16)));
    setWidth(next);
    save({ width: next, collapsed });
  }

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    save({ width, collapsed: next });
  }

  return (
    <aside
      ref={asideRef}
      style={{ width: collapsed ? COLLAPSED_WIDTH : width }}
      className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-black/15 pb-12 lg:flex print:hidden ${dragging ? "select-none" : ""}`}
    >
      <div className={`flex h-14 shrink-0 items-center ${collapsed ? "justify-center" : "justify-between pr-2 pl-5"}`}>
        {!collapsed && <Logo />}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? t("expandSidebar") : t("collapseSidebar")}
          title={collapsed ? t("expandSidebar") : t("collapseSidebar")}
          className="flex size-8 items-center justify-center rounded-md text-black/60 hover:bg-white/40 hover:text-black"
        >
          {collapsed ? (
            <PanelLeftOpen size={16} strokeWidth={1.75} aria-hidden />
          ) : (
            <PanelLeftClose size={16} strokeWidth={1.75} aria-hidden />
          )}
        </button>
      </div>
      <nav aria-label={label} className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-2 pb-4">
        <Suspense fallback={null}>
          <NavLinks viewer={viewer} collapsed={collapsed} />
        </Suspense>
      </nav>
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("resizeSidebar")}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={startDrag}
          onKeyDown={onHandleKey}
          onDoubleClick={() => {
            setWidth(DEFAULT_WIDTH);
            save({ width: DEFAULT_WIDTH, collapsed: false });
          }}
          className={`absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize after:absolute after:inset-y-0 after:left-[3px] after:w-0.5 after:transition-colors hover:after:bg-black/30 focus-visible:outline-none focus-visible:after:bg-black/50 ${dragging ? "after:bg-black/40" : ""}`}
        />
      )}
    </aside>
  );
}
