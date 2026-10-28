import { getTranslations, setRequestLocale } from "next-intl/server";
import { ImportForm } from "@/components/materials/ImportForm";
import { BackLink, SectionTabs } from "@/components/materials/ui";
import { materialKey, packagingKey } from "@/lib/materials/csv";
import { getViewer } from "@/lib/materials/viewer";

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("RawMaterials");
  const { supabase, role } = await getViewer();
  if (role !== "ADMIN" && role !== "MANAGER") {
    return <p className="rounded-[20px] bg-white p-6 text-sm text-[#3d3f3a]">{t("noAccess")}</p>;
  }
  const kind = (await searchParams).tab === "packaging" ? "packaging" : "materials";

  // Existing products, for the duplicate check before anything is written.
  let existing: string[] = [];
  let types: { id: string; name: string }[] = [];
  if (kind === "materials") {
    const [{ data: materials }, { data: typeRows }] = await Promise.all([
      supabase.from("materials").select("name, brand, specification").neq("status", "ARCHIVED"),
      supabase.from("material_types").select("id, name").eq("is_active", true).order("sort_order"),
    ]);
    existing = (materials ?? []).map((m) => materialKey(m.name, m.brand, m.specification));
    types = typeRows ?? [];
  } else {
    const { data: items } = await supabase.from("packaging_items").select("name, brand").neq("status", "ARCHIVED");
    existing = (items ?? []).map((item) => packagingKey(item.name, item.brand));
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink href={kind === "packaging" ? "/raw-materials?tab=packaging" : "/raw-materials"} label={t("title")} />
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[32px] font-normal">{t("import.title")}</h1>
        <p className="text-sm text-[#3d3f3a]">{t("import.intro")}</p>
      </div>
      <SectionTabs active={kind} basePath="/raw-materials/import" />
      <ImportForm
        key={kind}
        kind={kind}
        locale={locale}
        types={types}
        existingKeys={existing}
        isAdmin={role === "ADMIN"}
      />
    </div>
  );
}
