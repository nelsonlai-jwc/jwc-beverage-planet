// CSV import of recipes as drafts. One row per recipe; the ingredient, packaging and
// step cells use the same format as the recipe export, so an exported file can be
// edited and uploaded again. Headers carry both languages, e.g. "product_name (产品名称)".

import { header, normalize, parseCsv } from "@/lib/materials/csv";
import { letterFor } from "./letters";

type Column = { key: string; zh: string };

export const RECIPE_IMPORT_COLUMNS: Column[] = [
  { key: "outlet", zh: "分店" },
  { key: "product_name", zh: "产品名称" },
  { key: "type", zh: "类型" },
  { key: "style", zh: "Style" },
  { key: "temperature", zh: "温度" },
  { key: "purpose", zh: "用途" },
  { key: "yield", zh: "产量" },
  { key: "introduction", zh: "简介" },
  { key: "ingredients", zh: "原料" },
  { key: "packaging", zh: "包装" },
  { key: "steps", zh: "制作步骤" },
];

const REQUIRED = ["outlet", "product_name", "type"];
export const MAX_IMPORT_ROWS = 200;

export type Unit = "g" | "ml";

/** What the checker needs to know, prepared by the import page. */
export type RecipeImportLookups = {
  /** Outlets the viewer can create recipes for. */
  outlets: { id: string; name: string }[];
  /** Admin only: the recipe may be for all outlets. */
  allowAll: boolean;
  /** Each lower-case alias (code or name in any language) → value. */
  allOutlets: string[];
  types: Record<string, "DRINK" | "PREP">;
  styles: Record<string, string>;
  temps: Record<string, string>;
  purposes: Record<string, string>;
  materials: { id: string; name: string; brand: string | null; unit: Unit | null }[];
  preps: { id: string; name: string; unit: Unit | null; allOutlets: boolean; outletIds: string[] }[];
  packaging: { id: string; name: string; brand: string | null }[];
  /** Active drinks already in the system: name + temperature key and outlets. */
  existing: { key: string; allOutlets: boolean; outletIds: string[] }[];
};

export type ImportRecipeRow = {
  outletIds: string[];
  allOutlets: boolean;
  isPrep: boolean;
  draft: {
    product_name: string;
    purpose: string;
    style: string | null;
    temperature: string | null;
    yield_quantity: number | null;
    yield_unit: Unit | null;
    introduction: string | null;
    ingredients: { material_id: string | null; prep_recipe_id: string | null; quantity: number | null; unit: Unit | null; notes: null }[];
    packaging: { packaging_item_id: string; pieces: number }[];
    steps: { instruction: string; media_asset_id: null }[];
  };
};

export type ImportError = { code: string; name?: string };
export type CheckedRecipeRow = {
  line: number;
  values: Record<string, string>;
  row: ImportRecipeRow | null;
  errors: ImportError[];
};

const NUMBER = /^\d+(\.\d+)?$/;
const label = (item: { name: string; brand: string | null }) => (item.brand ? `${item.name} (${item.brand})` : item.name);

/** Splits a list cell on ";" or line breaks, dropping empty parts. */
function items(cell: string) {
  return cell
    .split(/[;\r\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function unitOf(text: string | undefined): Unit | null {
  const unit = (text ?? "").toLowerCase();
  return unit === "g" || unit === "ml" ? unit : null;
}

/** Same as the export's "A Name (Brand) 18 g": letter and quantity are optional. */
function splitIngredient(text: string, index: number) {
  let rest = text.trim();
  const letter = rest.match(/^([A-Z]{1,2})\s+(.+)$/);
  if (letter && letter[1] === letterFor(index)) rest = letter[2].trim();
  const withQuantity = rest.match(/^(.*\S)\s+(\d+(?:\.\d+)?)\s*(g|ml)?$/i);
  if (withQuantity) return { whole: rest, name: withQuantity[1], quantity: withQuantity[2], unit: withQuantity[3] };
  const noQuantity = rest.match(/^(.*\S)\s+—\s*(g|ml)?$/i);
  if (noQuantity) return { whole: rest, name: noQuantity[1], quantity: "", unit: noQuantity[2] };
  return { whole: rest, name: rest, quantity: "", unit: undefined };
}

/** Same as the export's "Name (Brand) × 2"; pieces default to 1. */
function splitPackaging(text: string) {
  const match = text.match(/^(.*\S)(?:\s*×|\s+[xX*])\s*(\S+)$/);
  return match ? { name: match[1], pieces: match[2] } : { name: text, pieces: "1" };
}

function covers(prep: { allOutlets: boolean; outletIds: string[] }, row: { allOutlets: boolean; outletIds: string[] }) {
  if (prep.allOutlets) return true;
  if (row.allOutlets) return false;
  return row.outletIds.every((id) => prep.outletIds.includes(id));
}

function overlaps(a: { allOutlets: boolean; outletIds: string[] }, b: { allOutlets: boolean; outletIds: string[] }) {
  return a.allOutlets || b.allOutlets || a.outletIds.some((id) => b.outletIds.includes(id));
}

function columnIndex(headerRow: string[]) {
  const index = new Map<string, number>();
  headerRow.forEach((text, i) => {
    const raw = text.trim();
    const english = raw.replace(/\s*\(.*\)\s*$/, "").toLowerCase();
    const inParens = raw.match(/\((.*)\)\s*$/)?.[1]?.trim();
    const column = RECIPE_IMPORT_COLUMNS.find(
      (c) => c.key === english || c.zh === raw || c.zh === inParens || c.zh.toLowerCase() === english,
    );
    if (column && !index.has(column.key)) index.set(column.key, i);
  });
  return index;
}

/**
 * Reads the file and checks every row: outlets the viewer manages, known type, style,
 * temperature and purpose, ingredients, Preps and packaging that already exist, and
 * drink names not already used (name + temperature) in the same outlets.
 */
export function checkRecipeFile(
  text: string,
  lookups: RecipeImportLookups,
): { missingColumns: string[]; tooMany: boolean; rows: CheckedRecipeRow[] } {
  const [headerRow = [], ...body] = parseCsv(text);
  const index = columnIndex(headerRow);
  const missingColumns = REQUIRED.filter((key) => !index.has(key)).map((key) =>
    header(RECIPE_IMPORT_COLUMNS.find((c) => c.key === key)!),
  );
  if (missingColumns.length) return { missingColumns, tooMany: false, rows: [] };

  const outletByName = new Map(lookups.outlets.map((o) => [normalize(o.name), o.id]));
  const seen: { key: string; allOutlets: boolean; outletIds: string[] }[] = [];
  const rows: CheckedRecipeRow[] = [];

  body.forEach((cells, i) => {
    if (cells.every((value) => value.trim() === "")) return;
    const values = Object.fromEntries(
      RECIPE_IMPORT_COLUMNS.map((c) => [c.key, cells[index.get(c.key) ?? -1] ?? ""]),
    );
    const errors: ImportError[] = [];

    // Outlets: names split by ",", ";" or line breaks, or "All outlets" (Admin).
    const outletCell = values.outlet.trim();
    let allOutlets = false;
    const outletIds: string[] = [];
    if (!outletCell) errors.push({ code: "OUTLET_REQUIRED" });
    else if (lookups.allOutlets.includes(normalize(outletCell))) {
      if (lookups.allowAll) allOutlets = true;
      else errors.push({ code: "ALL_NOT_ALLOWED" });
    } else {
      for (const name of outletCell.split(/[,;\r\n]+/).map((s) => s.trim()).filter(Boolean)) {
        const id = outletByName.get(normalize(name));
        if (!id) errors.push({ code: "OUTLET_UNKNOWN", name });
        else if (!outletIds.includes(id)) outletIds.push(id);
      }
    }
    const scope = { allOutlets, outletIds };

    const type = lookups.types[normalize(values.type)];
    if (!type) errors.push({ code: "TYPE_INVALID" });
    const isPrep = type === "PREP";

    const name = values.product_name.trim().replace(/\s+/g, " ");
    if (!name) errors.push({ code: "NAME_REQUIRED" });
    else if (name.length > 80) errors.push({ code: "NAME_TOO_LONG" });

    const pick = (map: Record<string, string>, cell: string, code: string) => {
      if (!cell.trim()) return null;
      const value = map[normalize(cell)];
      if (!value) errors.push({ code, name: cell.trim() });
      return value ?? null;
    };
    const style = isPrep ? "PREP_MATERIAL" : pick(lookups.styles, values.style, "STYLE_UNKNOWN");
    const temperature = isPrep ? null : pick(lookups.temps, values.temperature, "TEMP_UNKNOWN");
    const purpose = pick(lookups.purposes, values.purpose, "PURPOSE_UNKNOWN") ?? "RND";

    // Prep yield, e.g. "1000 ml".
    let yieldQuantity: number | null = null;
    let yieldUnit: Unit | null = null;
    if (isPrep && values.yield.trim()) {
      const match = values.yield.trim().match(/^(\d+(?:\.\d+)?)\s*(g|ml)$/i);
      if (!match || Number(match[1]) <= 0) errors.push({ code: "YIELD_INVALID" });
      else {
        yieldQuantity = Number(match[1]);
        yieldUnit = unitOf(match[2]);
      }
    }

    const introduction = values.introduction.trim() || null;
    if (introduction && introduction.length > 2000) errors.push({ code: "INTRO_TOO_LONG" });

    const ingredients: ImportRecipeRow["draft"]["ingredients"] = [];
    items(values.ingredients).forEach((text, position) => {
      const part = splitIngredient(text, position);
      const find = (wanted: string) => {
        const n = normalize(wanted);
        const preps = lookups.preps.filter((p) => normalize(p.name) === n);
        const exact = [
          ...lookups.materials.filter((m) => normalize(label(m)) === n).map((m) => ({ kind: "m" as const, item: m })),
          ...preps.filter((p) => covers(p, scope)).map((p) => ({ kind: "p" as const, item: p })),
        ];
        const loose = exact.length
          ? exact
          : lookups.materials.filter((m) => normalize(m.name) === n).map((m) => ({ kind: "m" as const, item: m }));
        return { matches: loose, prepElsewhere: preps.length > 0 };
      };
      // A quantity at the end only counts when the rest is a known name.
      let found = find(part.name);
      let quantity = part.quantity;
      let unit = part.unit;
      if (!found.matches.length && part.name !== part.whole) {
        const whole = find(part.whole);
        if (whole.matches.length) {
          found = whole;
          quantity = "";
          unit = undefined;
        }
      }
      if (found.matches.length > 1) return errors.push({ code: "INGREDIENT_AMBIGUOUS", name: part.name });
      const match = found.matches[0];
      if (!match) {
        return errors.push({ code: found.prepElsewhere ? "PREP_NOT_COVERED" : "INGREDIENT_UNKNOWN", name: part.name });
      }
      if (quantity && (!NUMBER.test(quantity) || Number(quantity) <= 0)) {
        return errors.push({ code: "QUANTITY_INVALID", name: part.name });
      }
      ingredients.push({
        material_id: match.kind === "m" ? match.item.id : null,
        prep_recipe_id: match.kind === "p" ? match.item.id : null,
        quantity: quantity ? Number(quantity) : null,
        unit: unitOf(unit) ?? match.item.unit,
        notes: null,
      });
    });

    const packaging: ImportRecipeRow["draft"]["packaging"] = [];
    items(values.packaging).forEach((text) => {
      const part = splitPackaging(text);
      const n = normalize(part.name);
      let matches = lookups.packaging.filter((p) => normalize(label(p)) === n);
      if (!matches.length) matches = lookups.packaging.filter((p) => normalize(p.name) === n);
      if (!matches.length) {
        const whole = lookups.packaging.filter((p) => normalize(label(p)) === normalize(text));
        if (whole.length) {
          matches = whole;
          part.pieces = "1";
        }
      }
      if (matches.length > 1) return errors.push({ code: "PACKAGING_AMBIGUOUS", name: part.name });
      if (!matches.length) return errors.push({ code: "PACKAGING_UNKNOWN", name: part.name });
      if (!NUMBER.test(part.pieces) || Number(part.pieces) <= 0) {
        return errors.push({ code: "PIECES_INVALID", name: part.name });
      }
      packaging.push({ packaging_item_id: matches[0].id, pieces: Number(part.pieces) });
    });

    // One step per line; a leading "1." is dropped. [A], [B] refer to the ingredients.
    const steps = values.steps
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\d+\s*[.)、]\s*/, "").trim())
      .filter(Boolean)
      .map((instruction) => ({ instruction, media_asset_id: null }));

    // Drinks: name + temperature once per outlet, as on submit.
    if (name && !isPrep && type) {
      const key = `${normalize(name)}|${temperature ?? ""}`;
      const entry = { key, ...scope };
      if (lookups.existing.some((e) => e.key === key && overlaps(e, entry))) errors.push({ code: "DUPLICATE_EXISTING" });
      else if (seen.some((e) => e.key === key && overlaps(e, entry))) errors.push({ code: "DUPLICATE_IN_FILE" });
      seen.push(entry);
    }

    rows.push({
      line: i + 2,
      values,
      errors,
      row: errors.length
        ? null
        : {
            outletIds,
            allOutlets,
            isPrep,
            draft: {
              product_name: name,
              purpose,
              style,
              temperature,
              yield_quantity: yieldQuantity,
              yield_unit: yieldUnit,
              introduction,
              ingredients,
              packaging,
              steps,
            },
          },
    });
  });

  return { missingColumns, tooMany: rows.length > MAX_IMPORT_ROWS, rows };
}
