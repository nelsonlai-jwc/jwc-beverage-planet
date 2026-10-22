import { getTranslations, setRequestLocale } from "next-intl/server";
import { PackagingForm } from "@/components/materials/PackagingForm";
import { BackLink } from "@/components/materials/ui";
import { getViewer } from "@/lib/materials/viewer";

export default async function NewPackagingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("RawMaterials");
  const { role } = await getViewer();

  if (role !== "ADMIN" && role !== "MANAGER") {
    return <p className="rounded-[20px] bg-white p-6 text-sm text-[#3d3f3a]">{t("noAccess")}</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/raw-materials?tab=packaging" label={t("tabPackaging")} />
      <h1 className="font-serif text-[32px] font-normal">{t("newPackaging")}</h1>
      <PackagingForm />
    </div>
  );
}
