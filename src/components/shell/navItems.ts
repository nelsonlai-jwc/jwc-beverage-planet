import { BarChart3, BookOpenText, ClipboardList, Coffee, CupSoda, MessageSquareText, Package, Settings, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { UserRole } from "@/lib/auth/currentUser";

/** Who is looking at the menu: decides which items and sub-items show. */
export type NavViewer = {
  /** Role shown to the user ("ADMIN" for an outlet Admin too). */
  displayRole: UserRole;
  /** Permission role: only the Super Admin is "ADMIN". */
  role: UserRole;
  outletAdmin: boolean;
};

export type NavChild = {
  href: string;
  /** Message key under the root namespace, e.g. "Recipes.tabs.mine". */
  label: string;
  /** Matches the current path + ?tab= value. */
  match: (pathname: string, tab: string | null) => boolean;
  show?: (viewer: NavViewer) => boolean;
};

export type NavKey =
  | "users"
  | "rawMaterials"
  | "recipes"
  | "menus"
  | "calibration"
  | "surveys"
  | "reports"
  | "feedback"
  | "settings";

export type NavItem = {
  href: string;
  key: NavKey;
  icon: LucideIcon;
  roles: readonly UserRole[];
  /** Draw a divider line above this item. */
  dividerBefore?: boolean;
  children?: readonly NavChild[];
};

const reviewer = (v: NavViewer) => v.role === "ADMIN" || v.outletAdmin;

// Roles that can use each page; the pages keep their own access checks.
export const navItems: readonly NavItem[] = [
  { href: "/users", key: "users", icon: Users, roles: ["ADMIN"] },
  {
    href: "/raw-materials",
    key: "rawMaterials",
    icon: Package,
    roles: ["ADMIN", "MANAGER"],
    children: [
      {
        href: "/raw-materials",
        label: "RawMaterials.tabMaterials",
        match: (p, tab) =>
          p.startsWith("/raw-materials") &&
          !p.startsWith("/raw-materials/packaging") &&
          !p.startsWith("/raw-materials/approvals") &&
          tab !== "packaging",
      },
      {
        href: "/raw-materials?tab=packaging",
        label: "RawMaterials.tabPackaging",
        match: (p, tab) =>
          p.startsWith("/raw-materials/packaging") || (p.startsWith("/raw-materials") && tab === "packaging"),
      },
      {
        href: "/raw-materials/approvals",
        label: "RawMaterials.approvals",
        match: (p) => p.startsWith("/raw-materials/approvals"),
        show: reviewer,
      },
    ],
  },
  {
    href: "/recipes",
    key: "recipes",
    icon: CupSoda,
    roles: ["ADMIN", "MANAGER", "BARISTA"],
    // Same tabs as the recipes page shows for each role (none for Barista).
    children: [
      {
        href: "/recipes",
        label: "Recipes.tabs.mine",
        match: (p, tab) => p === "/recipes" && (!tab || tab === "mine"),
        show: (v) => v.role !== "BARISTA",
      },
      {
        href: "/recipes?tab=pending",
        label: "Recipes.tabs.pending",
        match: (p, tab) => p === "/recipes" && tab === "pending",
        show: reviewer,
      },
      {
        href: "/recipes?tab=catalogue",
        label: "Recipes.tabs.catalogue",
        match: (p, tab) => p === "/recipes" && tab === "catalogue",
        show: (v) => v.role !== "BARISTA",
      },
      {
        href: "/recipes?tab=sync",
        label: "Recipes.tabs.sync",
        match: (p, tab) => p === "/recipes" && tab === "sync",
        show: (v) => v.role === "ADMIN",
      },
    ],
  },
  { href: "/menus", key: "menus", icon: BookOpenText, roles: ["ADMIN", "MANAGER", "BARISTA"] },
  {
    href: "/calibration",
    key: "calibration",
    icon: Coffee,
    roles: ["ADMIN", "MANAGER", "BARISTA"],
  },
  { href: "/surveys", key: "surveys", icon: ClipboardList, roles: ["ADMIN", "MANAGER", "BARISTA"] },
  {
    href: "/reports",
    key: "reports",
    icon: BarChart3,
    roles: ["ADMIN", "MANAGER"],
    dividerBefore: true,
    children: [
      { href: "/reports/cost", label: "Reports.cost.title", match: (p) => p.startsWith("/reports/cost") },
      { href: "/reports/rnd", label: "Reports.rnd.title", match: (p) => p.startsWith("/reports/rnd") },
      { href: "/reports/menus", label: "Reports.menus.title", match: (p) => p.startsWith("/reports/menus") },
    ],
  },
  { href: "/feedback", key: "feedback", icon: MessageSquareText, roles: ["ADMIN", "MANAGER", "BARISTA"] },
  { href: "/settings", key: "settings", icon: Settings, roles: ["ADMIN", "MANAGER", "BARISTA"] },
];
