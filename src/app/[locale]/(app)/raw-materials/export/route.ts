import { getTranslations } from "next-intl/server";
import { formatUnitCost } from "@/lib/materials/decimal";
import {
  MATERIAL_COLUMNS,
  MATERIAL_EXPORT_EXTRA,
  PACKAGING_COLUMNS,
  PACKAGING_EXPORT_EXTRA,
  toCsv,
} from "@/lib/materials/csv";
import { getViewer } from "@/lib/materials/viewer";

function csvResponse(csv: string, filename: string) {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

const date = (value: string) => value.slice(0, 10);

/** All materials or packaging except archived ones, in the same columns the import reads. */
export async function GET(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "RawMaterials" });
  const { supabase, role } = await getViewer();
  if (role !== "ADMIN" && role !== "MANAGER") return new Response(t("noAccess"), { status: 403 });

  const tab = new URL(request.url).searchParams.get("tab") === "packaging" ? "packaging" : "materials";
  const stamp = new Date().toISOString().slice(0, 10);

  if (tab === "packaging") {
    const { data } = await supabase
      .from("packaging_items")
      .select("name, brand, description, status, updated_at, packaging_prices(price_per_piece, free_reason, status)")
      .neq("status", "ARCHIVED")
      .order("name");
    const rows = (data ?? []).map((item) => {
      const price =
        item.packaging_prices.find((p) => p.status === "APPROVED") ??
        item.packaging_prices.find((p) => p.status !== "SUPERSEDED");
      return [
        item.name,
        item.brand,
        price?.price_per_piece ?? null,
        price?.free_reason ?? null,
        item.description,
        t(`status.${item.status}`),
        date(item.updated_at),
      ];
    });
    return csvResponse(toCsv([...PACKAGING_COLUMNS, ...PACKAGING_EXPORT_EXTRA], rows), `packaging-${stamp}.csv`);
  }

  const { data } = await supabase
    .from("materials")
    .select(
      "id, name, brand, no_brand, specification, description, abv, bx, is_coffee_bean, status, updated_at, cost_pack_id, material_types(name), material_packs!material_packs_material_id_fkey(id, pack_quantity, unit, description, status, material_price_versions(price, free_reason, status))",
    )
    .neq("status", "ARCHIVED")
    .order("name");
  const ids = (data ?? []).map((m) => m.id);
  const { data: costs } = ids.length
    ? await supabase.from("material_current_costs").select("material_id, unit, unit_cost").in("material_id", ids)
    : { data: [] };
  const costById = new Map((costs ?? []).map((c) => [c.material_id, c]));

  const rows = (data ?? []).map((m) => {
    const packs = m.material_packs.filter((p) => p.status !== "ARCHIVED");
    const pack = packs.find((p) => p.id === m.cost_pack_id) ?? packs[0];
    const price =
      pack?.material_price_versions.find((p) => p.status === "APPROVED") ??
      pack?.material_price_versions.find((p) => p.status !== "SUPERSEDED");
    const cost = costById.get(m.id);
    return [
      m.name,
      m.brand,
      m.no_brand ? "yes" : "no",
      m.material_types?.name ?? "",
      m.specification,
      m.description,
      pack ? Number(pack.pack_quantity) : null,
      pack?.unit ?? null,
      price?.price ?? null,
      price?.free_reason ?? null,
      pack?.description ?? null,
      m.abv,
      m.bx,
      m.is_coffee_bean ? "yes" : "no",
      cost?.unit_cost != null ? `${formatUnitCost(cost.unit_cost)} / ${cost.unit}` : "",
      t(`status.${m.status}`),
      date(m.updated_at),
    ];
  });
  return csvResponse(toCsv([...MATERIAL_COLUMNS, ...MATERIAL_EXPORT_EXTRA], rows), `materials-${stamp}.csv`);
}
