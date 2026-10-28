// Readable field changes for change requests and the change log.

export type FieldChange = { field: string; from: string; to: string };

// User-facing columns, in display order; everything else (ids, timestamps,
// revision counters, normalised copies) is left out of the log. Status changes
// are shown from the approval events and change requests instead.
export const MATERIAL_FIELDS = [
  "name",
  "brand",
  "no_brand",
  "specification",
  "material_type_id",
  "description",
  "abv",
  "bx",
  "is_coffee_bean",
  "photo_asset_id",
];
export const PACKAGING_FIELDS = ["name", "brand", "description"];
export const PACK_FIELDS = ["pack_quantity", "unit", "description"];
export const PRICE_FIELDS = ["price", "price_per_piece", "free_reason"];

type Formatter = {
  yes: string;
  no: string;
  changed: string;
  typeName: (id: string) => string | undefined;
  status: (status: string) => string;
};

export function formatValue(field: string, value: unknown, f: Formatter): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? f.yes : f.no;
  if (field === "material_type_id") return f.typeName(String(value)) ?? "—";
  if (field === "photo_asset_id") return f.changed;
  if (field === "status") return f.status(String(value));
  if (field === "price" || field === "price_per_piece") return `RM${Number(value).toFixed(2)}`;
  if (field === "abv" || field === "bx") return `${Number(value)}%`;
  if (field === "pack_quantity") return String(Number(value));
  return String(value);
}

/** Fields whose value differs between two rows, limited to `fields`. */
export function diffRows(
  fields: string[],
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  f: Formatter,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of fields) {
    const a = before?.[field] ?? null;
    const b = after?.[field] ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    // Form input sends "40" where the database row holds 40.00; compare numbers by value.
    if ((typeof a === "number" || typeof b === "number") && a !== null && b !== null && Number(a) === Number(b)) continue;
    changes.push({ field, from: before ? formatValue(field, a, f) : "", to: formatValue(field, b, f) });
  }
  return changes;
}
