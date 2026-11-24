"use server";

import { revalidatePath } from "next/cache";
import { isCoffeeBeanType } from "@/lib/materials/coffeeBean";
import {
  SHOP_SIZES,
  fetchShopBeans,
  gramsOf,
  planShopSync,
  type ExistingMaterial,
  type SyncPlan,
} from "@/lib/materials/shopBeans";
import { getViewer } from "@/lib/materials/viewer";
import type { Json } from "@/types/database";

type Supabase = Awaited<ReturnType<typeof getViewer>>["supabase"];

export type SyncSummary = { linked: number; created: number; unavailable: number; available: number };
export type SyncResult = { ok: true; summary: SyncSummary } | { ok: false; error: string };

/** Coffee bean raw materials that are not archived, for matching with the shop. */
async function existingBeans(supabase: Supabase): Promise<ExistingMaterial[]> {
  const { data } = await supabase
    .from("materials")
    .select(
      "id, name, brand, shop_variant_id, unavailable, cost_pack_id, material_types(name), material_packs!material_packs_material_id_fkey(id, pack_quantity, unit)",
    )
    .neq("status", "ARCHIVED");
  return (data ?? [])
    .filter((m) => m.shop_variant_id != null || isCoffeeBeanType(m.material_types?.name))
    .map((m) => {
      const pack = m.material_packs.find((p) => p.id === m.cost_pack_id);
      return {
        id: m.id,
        name: m.name,
        brand: m.brand,
        shopVariantId: m.shop_variant_id,
        unavailable: m.unavailable,
        packGrams: pack ? gramsOf(`${Number(pack.pack_quantity)}${pack.unit}`) : null,
      };
    });
}

/** Reads the shop and lines it up with raw materials. Super Admin only. */
export async function loadShopPlan(): Promise<{ ok: true; plan: SyncPlan } | { ok: false; error: string }> {
  const { supabase, role } = await getViewer();
  if (role !== "ADMIN") return { ok: false, error: "NOT_ALLOWED" };
  try {
    const [products, existing] = await Promise.all([fetchShopBeans(), existingBeans(supabase)]);
    return { ok: true, plan: planShopSync(products, existing) };
  } catch {
    return { ok: false, error: "SHOP_UNREACHABLE" };
  }
}

/**
 * Adds the new sizes the Super Admin ticked, links beans found by name, and copies the shop's
 * availability onto every linked bean. The shop is read again here, so what is written is
 * what the shop shows now.
 */
export async function runShopSync(sizes: number[]): Promise<SyncResult> {
  const { supabase, role } = await getViewer();
  if (role !== "ADMIN") return { ok: false, error: "NOT_ALLOWED" };
  const ticked = new Set(sizes.filter((size) => (SHOP_SIZES as readonly number[]).includes(size)));

  let products;
  try {
    products = await fetchShopBeans();
  } catch {
    return { ok: false, error: "SHOP_UNREACHABLE" };
  }
  const { rows } = planShopSync(products, await existingBeans(supabase));

  const links = rows.filter((r) => r.link).map((r) => ({ material_id: r.materialId, variant_id: r.variantId }));
  const created = rows
    .filter((r) => !r.materialId && ticked.has(r.grams))
    .map((r) => ({
      variant_id: r.variantId,
      name: r.name,
      grams: r.grams,
      price: r.price,
      espresso: r.espresso,
      filter: r.filter,
    }));
  const variants = rows.map((r) => ({ variant_id: r.variantId, available: r.available }));

  const { data, error } = await supabase.rpc("sync_shop_beans", {
    p_links: links as Json,
    p_new: created as Json,
    p_variants: variants as Json,
  });
  revalidatePath("/", "layout");
  if (error) {
    if (error.code === "42501") return { ok: false, error: "NOT_ALLOWED" };
    if (error.message === "NO_COFFEE_BEAN_TYPE") return { ok: false, error: "NO_COFFEE_BEAN_TYPE" };
    return { ok: false, error: "UNKNOWN" };
  }
  return { ok: true, summary: data as SyncSummary };
}
