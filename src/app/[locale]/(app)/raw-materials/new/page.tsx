import { getTranslations, setRequestLocale } from "next-intl/server";
import { MaterialForm } from "@/components/materials/MaterialForm";
import { BackLink } from "@/components/materials/ui";
import { getViewer } from "@/lib/materials/viewer";

export default async function NewMaterialPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("RawMaterials");
  const { supabase, role } = await getViewer();

  if (role !== "ADMIN" && role !== "MANAGER") {
    return <p className="rounded-[20px] bg-white p-6 text-sm text-[#3d3f3a]">{t("noAccess")}</p>;
  }
  const { data: types } = await supabase
    .from("material_types")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order");

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/raw-materials" label={t("title")} />
      <h1 className="font-serif text-[32px] font-normal">{t("newMaterial")}</h1>
      <MaterialForm types={types ?? []} />
    </div>
  );
}
