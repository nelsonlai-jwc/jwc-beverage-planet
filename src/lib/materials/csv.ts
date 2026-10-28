// CSV import and export for materials and packaging. Headers carry both languages,
// e.g. "name (名称)"; on import a column is matched by either part.

import { isDecimal, isPositiveDecimal } from "./decimal";

export type ImportKind = "materials" | "packaging";

type Column = { key: string; zh: string };

export const MATERIAL_COLUMNS: Column[] = [
  { key: "name", zh: "名称" },
  { key: "brand", zh: "品牌" },
  { key: "no_brand", zh: "无品牌" },
  { key: "type", zh: "类别" },
  { key: "specification", zh: "规格" },
  { key: "description", zh: "详情" },
  { key: "pack_size", zh: "包装量" },
  { key: "unit", zh: "单位" },
  { key: "price", zh: "采购价 MYR" },
  { key: "free_reason", zh: "免费原因" },
  { key: "pack_description", zh: "包装说明" },
  { key: "abv", zh: "ABV" },
  { key: "bx", zh: "Bx" },
  { key: "coffee_bean", zh: "咖啡豆" },
];

export const PACKAGING_COLUMNS: Column[] = [
  { key: "name", zh: "名称" },
  { key: "brand", zh: "品牌" },
  { key: "price", zh: "每件价格 MYR" },
  { key: "free_reason", zh: "免费原因" },
  { key: "description", zh: "详情" },
];

// Export only: read-only facts after the importable columns.
export const MATERIAL_EXPORT_EXTRA: Column[] = [
  { key: "unit_cost", zh: "每单位成本" },
  { key: "status", zh: "状态" },
  { key: "updated", zh: "更新时间" },
];
export const PACKAGING_EXPORT_EXTRA: Column[] = [
  { key: "status", zh: "状态" },
  { key: "updated", zh: "更新时间" },
];

export const header = (column: Column) => `${column.key} (${column.zh})`;

function cell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV text with a BOM so Excel opens Chinese as UTF-8. */
export function toCsv(columns: Column[], rows: (string | number | null)[][]) {
  return "﻿" + [columns.map(header), ...rows].map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** RFC 4180 parsing: quoted fields, doubled quotes, CRLF or LF line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Same as private.normalize_text: trimmed, single-spaced, lower case. */
export function normalize(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export const materialKey = (name: string, brand: string | null, specification: string | null) =>
  [normalize(name), normalize(brand), normalize(specification)].join("|");
export const packagingKey = (name: string, brand: string | null) => [normalize(name), normalize(brand)].join("|");

const YES = ["yes", "y", "true", "1", "是"];
const NO = ["no", "n", "false", "0", "否", ""];

export type MaterialRow = {
  name: string;
  brand: string | null;
  no_brand: boolean;
  material_type_id: string;
  specification: string | null;
  description: string | null;
  pack_quantity: number;
  unit: "g" | "ml";
  price: number | null;
  free_reason: string | null;
  pack_description: string | null;
  abv: number | null;
  bx: number | null;
  is_coffee_bean: boolean;
};

export type PackagingRow = {
  name: string;
  brand: string | null;
  price: number | null;
  free_reason: string | null;
  description: string | null;
};

export type CheckedRow<T> = { line: number; values: Record<string, string>; row: T | null; errors: string[] };

function columnIndex(headerRow: string[], columns: Column[]) {
  const index = new Map<string, number>();
  headerRow.forEach((text, i) => {
    const raw = text.trim();
    const english = raw.replace(/\s*\(.*\)\s*$/, "").toLowerCase();
    const inParens = raw.match(/\((.*)\)\s*$/)?.[1]?.trim();
    const column = columns.find(
      (c) => c.key === english || c.zh === raw || c.zh === inParens || c.zh.toLowerCase() === english,
    );
    if (column && !index.has(column.key)) index.set(column.key, i);
  });
  return index;
}

function blank(value: string) {
  return value.trim() === "";
}

function optional(value: string) {
  return blank(value) ? null : value.trim();
}

function checkPrice(values: Record<string, string>, errors: string[]) {
  const price = values.price.trim();
  if (price === "") return null;
  if (!isDecimal(price)) {
    errors.push("PRICE_INVALID");
    return null;
  }
  if (!isPositiveDecimal(price) && blank(values.free_reason)) errors.push("FREE_REASON_REQUIRED");
  return Number(price);
}

/**
 * Reads the file and checks every row against the same rules as the forms and the
 * database, so the import itself only fails on a change made in the meantime.
 */
export function checkMaterialFile(
  text: string,
  types: { id: string; name: string }[],
  existingKeys: Set<string>,
): { missingColumns: string[]; rows: CheckedRow<MaterialRow>[] } {
  return checkFile(text, MATERIAL_COLUMNS, ["name", "type", "pack_size", "unit"], (values, errors) => {
    if (blank(values.name)) errors.push("NAME_REQUIRED");
    else if (values.name.trim().length > 120) errors.push("NAME_TOO_LONG");
    const noBrand = YES.includes(values.no_brand.trim().toLowerCase());
    if (!noBrand && !NO.includes(values.no_brand.trim().toLowerCase())) errors.push("YES_NO_INVALID");
    if (!noBrand && blank(values.brand)) errors.push("BRAND_REQUIRED");
    const type = types.find((item) => normalize(item.name) === normalize(values.type));
    if (!type) errors.push("TYPE_UNKNOWN");
    if (!isPositiveDecimal(values.pack_size.trim())) errors.push("PACK_QUANTITY_INVALID");
    const unit = values.unit.trim().toLowerCase();
    if (unit !== "g" && unit !== "ml") errors.push("UNIT_INVALID");
    const price = checkPrice(values, errors);
    const percents = (["abv", "bx"] as const).map((key) => {
      const value = values[key].trim();
      if (value === "") return null;
      if (!isDecimal(value) || Number(value) > 100) {
        errors.push("PERCENT_INVALID");
        return null;
      }
      return Number(value);
    });
    const coffee = values.coffee_bean.trim().toLowerCase();
    if (!YES.includes(coffee) && !NO.includes(coffee)) errors.push("YES_NO_INVALID");

    const row: MaterialRow = {
      name: values.name.trim(),
      brand: noBrand ? null : values.brand.trim(),
      no_brand: noBrand,
      material_type_id: type?.id ?? "",
      specification: optional(values.specification),
      description: optional(values.description),
      pack_quantity: Number(values.pack_size.trim()),
      unit: unit === "g" ? "g" : "ml",
      price,
      free_reason: optional(values.free_reason),
      pack_description: optional(values.pack_description),
      abv: percents[0],
      bx: percents[1],
      is_coffee_bean: YES.includes(coffee),
    };
    return { row, key: materialKey(row.name, row.brand, row.specification) };
  }, existingKeys);
}

export function checkPackagingFile(
  text: string,
  existingKeys: Set<string>,
): { missingColumns: string[]; rows: CheckedRow<PackagingRow>[] } {
  return checkFile(text, PACKAGING_COLUMNS, ["name"], (values, errors) => {
    if (blank(values.name)) errors.push("NAME_REQUIRED");
    else if (values.name.trim().length > 120) errors.push("NAME_TOO_LONG");
    const price = checkPrice(values, errors);
    const row: PackagingRow = {
      name: values.name.trim(),
      brand: optional(values.brand),
      price,
      free_reason: optional(values.free_reason),
      description: optional(values.description),
    };
    return { row, key: packagingKey(row.name, row.brand) };
  }, existingKeys);
}

function checkFile<T>(
  text: string,
  columns: Column[],
  required: string[],
  check: (values: Record<string, string>, errors: string[]) => { row: T; key: string },
  existingKeys: Set<string>,
) {
  const [headerRow = [], ...body] = parseCsv(text);
  const index = columnIndex(headerRow, columns);
  const missingColumns = required.filter((key) => !index.has(key)).map((key) => {
    const column = columns.find((c) => c.key === key)!;
    return header(column);
  });
  if (missingColumns.length) return { missingColumns, rows: [] };

  const seen = new Set<string>();
  const rows: CheckedRow<T>[] = [];
  body.forEach((cells, i) => {
    if (cells.every((value) => value.trim() === "")) return;
    const values = Object.fromEntries(columns.map((c) => [c.key, cells[index.get(c.key) ?? -1] ?? ""]));
    const errors: string[] = [];
    const { row, key } = check(values, errors);
    if (existingKeys.has(key)) errors.push("DUPLICATE_EXISTING");
    else if (seen.has(key)) errors.push("DUPLICATE_IN_FILE");
    seen.add(key);
    rows.push({ line: i + 2, values, row: errors.length ? null : row, errors });
  });
  return { missingColumns, rows };
}
