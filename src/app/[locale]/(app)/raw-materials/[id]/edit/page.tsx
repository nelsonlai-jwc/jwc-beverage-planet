import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MaterialForm } from "@/components/materials/MaterialForm";
import { BackLink } from "@/components/materials/ui";
import { getViewer } from "@/lib/materials/viewer";
import { signedMediaUrl } from "@/lib/media/signedUrl";

// Drafts and returned materials are edited in place by their creator or an Admin. For an
// approved material only the product details change here: at once for an Admin, as a
// request for a Manager. Packs and prices keep their own approval on the detail page.
export default async function EditMaterialPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("RawMaterials");
  const { supabase, role, userId } = await getViewer();

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
  const isAdmin = role === "ADMIN";
  const approved = material.status === "APPROVED";
  const draft = material.status === "DRAFT" || material.status === "RETURNED";
  if (!(approved || (draft && (isAdmin || material.created_by === userId)))) {
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
        photoUrl={await signedMediaUrl(supabase, material.photo_asset_id)}
        approved={approved ? { isAdmin } : undefined}
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
          photoAssetId: material.photo_asset_id,
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
