import { getTranslations, setRequestLocale } from "next-intl/server";
import { MaterialForm } from "@/components/materials/MaterialForm";
import { BackLink } from "@/components/materials/ui";
import { toBeanOptions } from "@/lib/materials/coffeeBean";
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
  const [{ data: types }, { data: beanOptions }] = await Promise.all([
    supabase.from("material_types").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("coffee_bean_options").select("id, kind, name_en, name_zh, name_ms, is_active").order("sort_order"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/raw-materials" label={t("backToList")} />
      <h1 className="font-serif text-[26px] font-normal leading-tight md:text-[28px]">{t("newMaterial")}</h1>
      <MaterialForm types={types ?? []} beanOptions={toBeanOptions(beanOptions)} />
    </div>
  );
}
