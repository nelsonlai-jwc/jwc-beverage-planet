// Roles that can use each page; the pages keep their own access checks.
export const navItems = [
  { href: "/users", key: "users", roles: ["ADMIN"] },
  { href: "/raw-materials", key: "rawMaterials", roles: ["ADMIN", "MANAGER"] },
  { href: "/recipes", key: "recipes", roles: ["ADMIN", "MANAGER", "BARISTA"] },
  { href: "/menus", key: "menus", roles: ["ADMIN", "MANAGER", "BARISTA"] },
  { href: "/calibration", key: "calibration", roles: ["ADMIN", "MANAGER", "BARISTA"] },
  { href: "/reports", key: "reports", roles: ["ADMIN", "MANAGER"] },
  { href: "/settings", key: "settings", roles: ["ADMIN", "MANAGER", "BARISTA"] },
] as const;

export type NavKey = (typeof navItems)[number]["key"];
