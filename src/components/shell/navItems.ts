import { BarChart3, BookOpenText, Coffee, CupSoda, Package, Settings, Users } from "lucide-react";

// Roles that can use each page; the pages keep their own access checks.
export const navItems = [
  { href: "/users", key: "users", icon: Users, roles: ["ADMIN"] },
  { href: "/raw-materials", key: "rawMaterials", icon: Package, roles: ["ADMIN", "MANAGER"] },
  { href: "/recipes", key: "recipes", icon: CupSoda, roles: ["ADMIN", "MANAGER", "BARISTA"] },
  { href: "/menus", key: "menus", icon: BookOpenText, roles: ["ADMIN", "MANAGER", "BARISTA"] },
  { href: "/calibration", key: "calibration", icon: Coffee, roles: ["ADMIN", "MANAGER", "BARISTA"] },
  { href: "/reports", key: "reports", icon: BarChart3, roles: ["ADMIN", "MANAGER"] },
  { href: "/settings", key: "settings", icon: Settings, roles: ["ADMIN", "MANAGER", "BARISTA"] },
] as const;

export type NavKey = (typeof navItems)[number]["key"];
