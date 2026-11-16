// Menu categories: one tree per outlet. Main categories have no parent.

export type MenuCategory = {
  id: string;
  outletId: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
};

export type FlatCategory = MenuCategory & { depth: number; path: string[] };

export const CATEGORY_SELECT = "id, outlet_id, parent_id, name, sort_order";

export function toCategory(row: {
  id: string;
  outlet_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
}): MenuCategory {
  return {
    id: row.id,
    outletId: row.outlet_id,
    parentId: row.parent_id,
    name: row.name,
    sortOrder: row.sort_order,
  };
}

function bySortOrder(a: MenuCategory, b: MenuCategory) {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

export function childrenOf(categories: MenuCategory[], parentId: string | null): MenuCategory[] {
  return categories.filter((c) => c.parentId === parentId).sort(bySortOrder);
}

// Tree order (each category followed by its sub-categories), with depth and name path.
export function flattenCategories(categories: MenuCategory[]): FlatCategory[] {
  const result: FlatCategory[] = [];
  function walk(parentId: string | null, path: string[]) {
    for (const category of childrenOf(categories, parentId)) {
      const own = [...path, category.name];
      result.push({ ...category, depth: path.length, path: own });
      walk(category.id, own);
    }
  }
  walk(null, []);
  return result;
}

export function categoryLabel(category: FlatCategory): string {
  return category.path.join(" › ");
}

// Items grouped by category in tree order; uncategorized items (category null) come last.
// Empty groups are left out. Items keep their order inside a group.
export function groupByCategory<T extends { categoryId: string | null }>(
  items: T[],
  flat: FlatCategory[],
): { category: FlatCategory | null; items: T[] }[] {
  const known = new Set(flat.map((c) => c.id));
  const groups = flat.map((category) => ({
    category: category as FlatCategory | null,
    items: items.filter((item) => item.categoryId === category.id),
  }));
  groups.push({
    category: null,
    items: items.filter((item) => item.categoryId === null || !known.has(item.categoryId)),
  });
  return groups.filter((group) => group.items.length > 0);
}
