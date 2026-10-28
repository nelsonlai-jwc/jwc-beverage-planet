import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChangeLog } from "@/components/materials/ChangeLog";
import { BackLink } from "@/components/materials/ui";
import { getViewer } from "@/lib/materials/viewer";

export default async function HistoryPage({
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
  const { data: item } = await supabase.from("materials").select("name").eq("id", id).maybeSingle();
  if (!item) notFound();

  return (
    <div className="flex flex-col gap-6">
      <BackLink href={`/raw-materials/${id}`} label={item.name} />
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[32px] font-normal">{t("history.title")}</h1>
        <p className="text-sm text-[#3d3f3a]">{item.name}</p>
      </div>
      <ChangeLog entity="MATERIAL" id={id} />
    </div>
  );
}
