export const navItems = [
  { href: "/users", key: "users" },
  { href: "/raw-materials", key: "rawMaterials" },
  { href: "/recipes", key: "recipes" },
  { href: "/menus", key: "menus" },
  { href: "/calibration", key: "calibration" },
  { href: "/reports", key: "reports" },
  { href: "/settings", key: "settings" },
] as const;

export type NavKey = (typeof navItems)[number]["key"];
