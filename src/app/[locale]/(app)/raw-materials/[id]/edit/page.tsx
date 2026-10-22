import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MaterialForm } from "@/components/materials/MaterialForm";
import { BackLink } from "@/components/materials/ui";
import { getViewer } from "@/lib/materials/viewer";

// Only drafts and returned materials are edited in place; approved ones change through proposals.
export default async function EditMaterialPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("RawMaterials");
  const { supabase, role } = await getViewer();

  if (role !== "ADMIN" && role !== "MANAGER") {
    return <p className="rounded-[20px] bg-white p-6 text-sm text-[#3d3f3a]">{t("noAccess")}</p>;
  }
  const [{ data: material }, { data: types }] = await Promise.all([
    supabase
      .from("materials")
      .select(
        "*, material_packs!material_packs_material_id_fkey(id, pack_quantity, unit, description, status, created_at, material_price_versions(id, price, free_reason, status))",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("material_types").select("id, name").eq("is_active", true).order("sort_order"),
  ]);
  if (!material) notFound();
  if (material.status !== "DRAFT" && material.status !== "RETURNED") {
    return (
      <div className="flex flex-col gap-6">
        <BackLink href={`/raw-materials/${id}`} label={material.name} />
        <p className="rounded-[20px] bg-white p-6 text-sm text-[#3d3f3a]">{t("detail.notEditable")}</p>
      </div>
    );
  }

  const packs = [...material.material_packs].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const pack = packs.find((p) => p.id === material.cost_pack_id) ?? packs[0];
  const price = pack?.material_price_versions.find(
    (p) => p.status === "DRAFT" || p.status === "RETURNED",
  );

  return (
    <div className="flex flex-col gap-6">
      <BackLink href={`/raw-materials/${id}`} label={material.name} />
      <h1 className="font-serif text-[32px] font-normal">{t("detail.edit")}</h1>
      <MaterialForm
        types={types ?? []}
        initial={{
          id: material.id,
          name: material.name,
          brand: material.brand ?? "",
          noBrand: material.no_brand,
          materialTypeId: material.material_type_id,
          specification: material.specification ?? "",
          description: material.description ?? "",
          abv: material.abv?.toString() ?? "",
          bx: material.bx?.toString() ?? "",
          isCoffeeBean: material.is_coffee_bean,
          packId: pack?.id,
          packQuantity: pack ? String(pack.pack_quantity) : "",
          unit: pack?.unit ?? "ml",
          packDescription: pack?.description ?? "",
          priceId: price?.id,
          price: price ? String(price.price) : "",
          freeReason: price?.free_reason ?? "",
        }}
      />
    </div>
  );
}
