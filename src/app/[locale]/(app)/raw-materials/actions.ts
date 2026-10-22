"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { isDecimal, isPositiveDecimal } from "@/lib/materials/decimal";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Unit = Database["public"]["Enums"]["measure_unit"];

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

// Database error codes the page explains; anything else shows a generic message.
const KNOWN_ERRORS = [
  "NOT_ALLOWED",
  "NOT_SUBMITTABLE",
  "NOT_PENDING",
  "PACK_REQUIRED",
  "MATERIAL_NOT_APPROVED",
  "PACK_NOT_APPROVED",
  "PACKAGING_NOT_APPROVED",
  "PRICE_ALREADY_PENDING",
  "REASON_REQUIRED",
];

function fail(error: PostgrestError | null): ActionResult {
  if (!error) return { ok: false, error: "UNKNOWN" };
  if (error.code === "23505") return { ok: false, error: "DUPLICATE" };
  if (KNOWN_ERRORS.includes(error.message)) return { ok: false, error: error.message };
  if (error.code === "42501") return { ok: false, error: "NOT_ALLOWED" };
  return { ok: false, error: "UNKNOWN" };
}

function refresh() {
  revalidatePath("/", "layout");
}

function blank(value: string | undefined) {
  return !value || value.trim() === "";
}

/** A price is either a positive amount, or zero with a reason; blank means missing. */
function checkPrice(amount: string, freeReason: string): string | null {
  if (blank(amount)) return null;
  if (!isDecimal(amount)) return "PRICE_INVALID";
  if (!isPositiveDecimal(amount) && blank(freeReason)) return "FREE_REASON_REQUIRED";
  return null;
}

function percent(value: string): number | null {
  if (blank(value)) return null;
  return Number(value);
}

// Materials -------------------------------------------------------------

export type MaterialInput = {
  id?: string;
  name: string;
  brand: string;
  noBrand: boolean;
  materialTypeId: string;
  specification: string;
  description: string;
  abv: string;
  bx: string;
  isCoffeeBean: boolean;
  packId?: string;
  packQuantity: string;
  unit: Unit;
  packDescription: string;
  priceId?: string;
  price: string;
  freeReason: string;
  submit: boolean;
};

function checkMaterial(input: MaterialInput): string | null {
  if (blank(input.name)) return "NAME_REQUIRED";
  if (!input.noBrand && blank(input.brand)) return "BRAND_REQUIRED";
  if (blank(input.materialTypeId)) return "TYPE_REQUIRED";
  if (!isPositiveDecimal(input.packQuantity)) return "PACK_QUANTITY_INVALID";
  for (const value of [input.abv, input.bx]) {
    if (blank(value)) continue;
    if (!isDecimal(value) || Number(value) > 100) return "PERCENT_INVALID";
  }
  return checkPrice(input.price, input.freeReason);
}

export async function saveMaterial(input: MaterialInput): Promise<ActionResult> {
  const invalid = checkMaterial(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const fields = {
    name: input.name.trim(),
    brand: input.noBrand ? null : input.brand.trim(),
    no_brand: input.noBrand,
    material_type_id: input.materialTypeId,
    specification: blank(input.specification) ? null : input.specification.trim(),
    description: blank(input.description) ? null : input.description.trim(),
    abv: percent(input.abv),
    bx: percent(input.bx),
    is_coffee_bean: input.isCoffeeBean,
  };
  const pack = {
    pack_quantity: Number(input.packQuantity),
    unit: input.unit,
    description: blank(input.packDescription) ? null : input.packDescription.trim(),
  };
  const price = {
    price: Number(input.price),
    free_reason: blank(input.freeReason) ? null : input.freeReason.trim(),
  };

  let materialId = input.id;
  if (materialId) {
    const { error } = await supabase.from("materials").update(fields).eq("id", materialId);
    if (error) return fail(error);
  } else {
    const { data, error } = await supabase.from("materials").insert(fields).select("id").single();
    if (error) return fail(error);
    materialId = data.id;
  }

  let packId = input.packId;
  if (packId) {
    const { error } = await supabase.from("material_packs").update(pack).eq("id", packId);
    if (error) return fail(error);
  } else {
    const { data, error } = await supabase
      .from("material_packs")
      .insert({ ...pack, material_id: materialId })
      .select("id")
      .single();
    if (error) {
      // Undo the half-created draft so a retry does not hit the duplicate check.
      if (!input.id) await supabase.from("materials").delete().eq("id", materialId);
      return fail(error);
    }
    packId = data.id;
    const { error: linkError } = await supabase
      .from("materials")
      .update({ cost_pack_id: packId })
      .eq("id", materialId);
    if (linkError) return fail(linkError);
  }

  if (!blank(input.price)) {
    const { error } = input.priceId
      ? await supabase.from("material_price_versions").update(price).eq("id", input.priceId)
      : await supabase.from("material_price_versions").insert({ ...price, pack_id: packId });
    if (error) return fail(error);
  }

  if (input.submit) {
    const { error } = await supabase.rpc("submit_material", { p_material_id: materialId });
    if (error) {
      refresh();
      return fail(error);
    }
  }
  refresh();
  return { ok: true, id: materialId };
}

export async function submitMaterial(materialId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_material", { p_material_id: materialId });
  refresh();
  return error ? fail(error) : { ok: true };
}

/** Price change on an approved pack: a new price version sent straight for approval. */
export async function proposeMaterialPrice(
  packId: string,
  amount: string,
  freeReason: string,
): Promise<ActionResult> {
  if (blank(amount)) return { ok: false, error: "PRICE_INVALID" };
  const invalid = checkPrice(amount, freeReason);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("material_price_versions")
    .insert({
      pack_id: packId,
      price: Number(amount),
      free_reason: blank(freeReason) ? null : freeReason.trim(),
    })
    .select("id")
    .single();
  if (error) return fail(error);
  const { error: submitError } = await supabase.rpc("submit_material_price", { p_price_id: data.id });
  if (submitError) {
    await supabase.from("material_price_versions").delete().eq("id", data.id);
    return fail(submitError);
  }
  refresh();
  return { ok: true };
}

/** Another pack size for an approved material, sent for approval with its price. */
export async function proposeMaterialPack(
  materialId: string,
  quantity: string,
  unit: Unit,
  description: string,
  amount: string,
  freeReason: string,
): Promise<ActionResult> {
  if (!isPositiveDecimal(quantity)) return { ok: false, error: "PACK_QUANTITY_INVALID" };
  const invalid = checkPrice(amount, freeReason);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("material_packs")
    .insert({
      material_id: materialId,
      pack_quantity: Number(quantity),
      unit,
      description: blank(description) ? null : description.trim(),
    })
    .select("id")
    .single();
  if (error) return fail(error);
  if (!blank(amount)) {
    const { error: priceError } = await supabase.from("material_price_versions").insert({
      pack_id: data.id,
      price: Number(amount),
      free_reason: blank(freeReason) ? null : freeReason.trim(),
    });
    if (priceError) {
      await supabase.from("material_packs").delete().eq("id", data.id);
      return fail(priceError);
    }
  }
  const { error: submitError } = await supabase.rpc("submit_material_pack", { p_pack_id: data.id });
  refresh();
  return submitError ? fail(submitError) : { ok: true };
}

// Packaging -------------------------------------------------------------

export type PackagingInput = {
  id?: string;
  name: string;
  brand: string;
  description: string;
  priceId?: string;
  price: string;
  freeReason: string;
  submit: boolean;
};

export async function savePackaging(input: PackagingInput): Promise<ActionResult> {
  if (blank(input.name)) return { ok: false, error: "NAME_REQUIRED" };
  const invalid = checkPrice(input.price, input.freeReason);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const fields = {
    name: input.name.trim(),
    brand: blank(input.brand) ? null : input.brand.trim(),
    description: blank(input.description) ? null : input.description.trim(),
  };
  let itemId = input.id;
  if (itemId) {
    const { error } = await supabase.from("packaging_items").update(fields).eq("id", itemId);
    if (error) return fail(error);
  } else {
    const { data, error } = await supabase.from("packaging_items").insert(fields).select("id").single();
    if (error) return fail(error);
    itemId = data.id;
  }

  if (!blank(input.price)) {
    const price = {
      price_per_piece: Number(input.price),
      free_reason: blank(input.freeReason) ? null : input.freeReason.trim(),
    };
    const { error } = input.priceId
      ? await supabase.from("packaging_prices").update(price).eq("id", input.priceId)
      : await supabase.from("packaging_prices").insert({ ...price, packaging_item_id: itemId });
    if (error) return fail(error);
  }

  if (input.submit) {
    const { error } = await supabase.rpc("submit_packaging_item", { p_item_id: itemId });
    if (error) {
      refresh();
      return fail(error);
    }
  }
  refresh();
  return { ok: true, id: itemId };
}

export async function submitPackagingItem(itemId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_packaging_item", { p_item_id: itemId });
  refresh();
  return error ? fail(error) : { ok: true };
}

export async function proposePackagingPrice(
  itemId: string,
  amount: string,
  freeReason: string,
): Promise<ActionResult> {
  if (blank(amount)) return { ok: false, error: "PRICE_INVALID" };
  const invalid = checkPrice(amount, freeReason);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("packaging_prices")
    .insert({
      packaging_item_id: itemId,
      price_per_piece: Number(amount),
      free_reason: blank(freeReason) ? null : freeReason.trim(),
    })
    .select("id")
    .single();
  if (error) return fail(error);
  const { error: submitError } = await supabase.rpc("submit_packaging_price", { p_price_id: data.id });
  if (submitError) {
    await supabase.from("packaging_prices").delete().eq("id", data.id);
    return fail(submitError);
  }
  refresh();
  return { ok: true };
}

// Admin review ----------------------------------------------------------

export type ReviewKind = "material" | "pack" | "price" | "packaging" | "packagingPrice";

export async function review(
  kind: ReviewKind,
  id: string,
  decision: "approve" | "return",
  reason = "",
): Promise<ActionResult> {
  if (decision === "return" && blank(reason)) return { ok: false, error: "REASON_REQUIRED" };
  const supabase = await createClient();
  let error: PostgrestError | null;
  if (decision === "approve") {
    ({ error } = await (kind === "material"
      ? supabase.rpc("approve_material", { p_material_id: id })
      : kind === "pack"
        ? supabase.rpc("approve_material_pack", { p_pack_id: id })
        : kind === "price"
          ? supabase.rpc("approve_material_price", { p_price_id: id })
          : kind === "packaging"
            ? supabase.rpc("approve_packaging_item", { p_item_id: id })
            : supabase.rpc("approve_packaging_price", { p_price_id: id })));
  } else {
    ({ error } = await (kind === "material"
      ? supabase.rpc("return_material", { p_material_id: id, p_reason: reason })
      : kind === "pack"
        ? supabase.rpc("return_material_pack", { p_pack_id: id, p_reason: reason })
        : kind === "price"
          ? supabase.rpc("return_material_price", { p_price_id: id, p_reason: reason })
          : kind === "packaging"
            ? supabase.rpc("return_packaging_item", { p_item_id: id, p_reason: reason })
            : supabase.rpc("return_packaging_price", { p_price_id: id, p_reason: reason })));
  }
  refresh();
  return error ? fail(error) : { ok: true };
}
