"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { notifyReviewResult } from "@/lib/email/approval";
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
  "NOT_EDITABLE",
  "NOT_ARCHIVABLE",
  "NOT_ARCHIVED",
  "NOT_DELETABLE",
  "IN_USE",
  "NO_CHANGES",
  "REQUEST_ALREADY_PENDING",
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
  photoAssetId: string | null;
  packId?: string;
  packQuantity: string;
  unit: Unit;
  packDescription: string;
  priceId?: string;
  price: string;
  freeReason: string;
  submit: boolean;
};

function checkIdentity(input: MaterialDetails): string | null {
  if (blank(input.name)) return "NAME_REQUIRED";
  if (!input.noBrand && blank(input.brand)) return "BRAND_REQUIRED";
  if (blank(input.materialTypeId)) return "TYPE_REQUIRED";
  for (const value of [input.abv, input.bx]) {
    if (blank(value)) continue;
    if (!isDecimal(value) || Number(value) > 100) return "PERCENT_INVALID";
  }
  return null;
}

function checkMaterial(input: MaterialInput): string | null {
  const invalid = checkIdentity(input);
  if (invalid) return invalid;
  if (!isPositiveDecimal(input.packQuantity)) return "PACK_QUANTITY_INVALID";
  return checkPrice(input.price, input.freeReason);
}

function materialFields(input: MaterialDetails) {
  return {
    name: input.name.trim(),
    brand: input.noBrand ? null : input.brand.trim(),
    no_brand: input.noBrand,
    material_type_id: input.materialTypeId,
    specification: blank(input.specification) ? null : input.specification.trim(),
    description: blank(input.description) ? null : input.description.trim(),
    abv: percent(input.abv),
    bx: percent(input.bx),
    is_coffee_bean: input.isCoffeeBean,
    photo_asset_id: input.photoAssetId,
  };
}

export async function saveMaterial(input: MaterialInput): Promise<ActionResult> {
  const invalid = checkMaterial(input);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const fields = materialFields(input);
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

/** Identity fields only: what an edit of an approved material may change. */
export type MaterialDetails = Pick<
  MaterialInput,
  | "name"
  | "brand"
  | "noBrand"
  | "materialTypeId"
  | "specification"
  | "description"
  | "abv"
  | "bx"
  | "isCoffeeBean"
  | "photoAssetId"
>;

export type ChangeResult = { ok: true; outcome: "APPLIED" | "REQUESTED" } | { ok: false; error: string };

type ChangeEntity = "MATERIAL" | "PACKAGING_ITEM";

async function requestChange(
  entity: ChangeEntity,
  id: string,
  action: "EDIT" | "ARCHIVE",
  changes: Record<string, unknown> | null,
  reason: string,
): Promise<ChangeResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_change", {
    p_entity_type: entity,
    p_entity_id: id,
    p_action: action,
    p_changes: changes as Database["public"]["Tables"]["change_requests"]["Row"]["changes"],
    p_reason: blank(reason) ? null : reason.trim(),
  });
  refresh();
  if (error) return fail(error) as ChangeResult;
  return { ok: true, outcome: data === "APPLIED" ? "APPLIED" : "REQUESTED" };
}

/** Approved material: an Admin's edit applies at once, a Manager's goes to the Admin. */
export async function editApprovedMaterial(
  id: string,
  input: MaterialDetails,
  reason: string,
): Promise<ChangeResult> {
  const invalid = checkIdentity(input);
  if (invalid) return { ok: false, error: invalid };
  return requestChange("MATERIAL", id, "EDIT", materialFields(input), reason);
}

export async function editApprovedPackaging(
  id: string,
  input: Pick<PackagingInput, "name" | "brand" | "description">,
  reason: string,
): Promise<ChangeResult> {
  if (blank(input.name)) return { ok: false, error: "NAME_REQUIRED" };
  return requestChange("PACKAGING_ITEM", id, "EDIT", packagingFields(input), reason);
}

/** Archive ("delete") a returned or approved item; a Manager's request for approved items needs a reason. */
export async function archiveItem(entity: ChangeEntity, id: string, reason: string): Promise<ChangeResult> {
  return requestChange(entity, id, "ARCHIVE", null, reason);
}

export async function restoreItem(entity: ChangeEntity, id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("restore_archived", { p_entity_type: entity, p_entity_id: id });
  refresh();
  return error ? fail(error) : { ok: true };
}

/** Really deletes a draft that was never submitted. */
export async function deleteDraft(entity: ChangeEntity, id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } =
    entity === "MATERIAL"
      ? await supabase.rpc("delete_material_draft", { p_material_id: id })
      : await supabase.rpc("delete_packaging_draft", { p_item_id: id });
  refresh();
  return error ? fail(error) : { ok: true };
}

export async function reviewChangeRequest(
  id: string,
  decision: "approve" | "return",
  reason = "",
): Promise<ActionResult> {
  if (decision === "return" && blank(reason)) return { ok: false, error: "REASON_REQUIRED" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_change_request", {
    p_request_id: id,
    p_approve: decision === "approve",
    p_reason: blank(reason) ? null : reason.trim(),
  });
  refresh();
  if (error) return fail(error);
  await notifyReviewResult(supabase, { kind: "change", id, approved: decision === "approve", reason });
  return { ok: true };
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

function packagingFields(input: Pick<PackagingInput, "name" | "brand" | "description">) {
  return {
    name: input.name.trim(),
    brand: blank(input.brand) ? null : input.brand.trim(),
    description: blank(input.description) ? null : input.description.trim(),
  };
}

export async function savePackaging(input: PackagingInput): Promise<ActionResult> {
  if (blank(input.name)) return { ok: false, error: "NAME_REQUIRED" };
  const invalid = checkPrice(input.price, input.freeReason);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  const fields = packagingFields(input);
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
  if (error) return fail(error);
  await notifyReviewResult(supabase, { kind, id, approved: decision === "approve", reason });
  return { ok: true };
}

// CSV import ------------------------------------------------------------

/** Creates every row in one transaction; the page has already checked each row. */
export async function importItems(
  kind: "materials" | "packaging",
  rows: Record<string, unknown>[],
  approve: boolean,
): Promise<ActionResult & { count?: number }> {
  if (rows.length === 0) return { ok: false, error: "IMPORT_EMPTY" };
  const supabase = await createClient();
  const args = { p_rows: rows as Database["public"]["Tables"]["change_requests"]["Row"]["changes"], p_approve: approve };
  const { data, error } =
    kind === "materials"
      ? await supabase.rpc("import_materials", args)
      : await supabase.rpc("import_packaging_items", args);
  refresh();
  if (error) return fail(error);
  return { ok: true, count: data ?? 0 };
}
