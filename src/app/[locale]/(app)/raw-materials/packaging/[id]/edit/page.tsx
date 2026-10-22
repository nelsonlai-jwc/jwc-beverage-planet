import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PackagingForm } from "@/components/materials/PackagingForm";
import { BackLink } from "@/components/materials/ui";
import { getViewer } from "@/lib/materials/viewer";

export default async function EditPackagingPage({
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
  const { data: item } = await supabase
    .from("packaging_items")
    .select("*, packaging_prices(id, price_per_piece, free_reason, status)")
    .eq("id", id)
    .maybeSingle();
  if (!item) notFound();
  if (item.status !== "DRAFT" && item.status !== "RETURNED") {
    return (
      <div className="flex flex-col gap-6">
        <BackLink href={`/raw-materials/packaging/${id}`} label={item.name} />
        <p className="rounded-[20px] bg-white p-6 text-sm text-[#3d3f3a]">{t("detail.notEditable")}</p>
      </div>
    );
  }
  const price = item.packaging_prices.find((p) => p.status === "DRAFT" || p.status === "RETURNED");

  return (
    <div className="flex flex-col gap-6">
      <BackLink href={`/raw-materials/packaging/${id}`} label={item.name} />
      <h1 className="font-serif text-[32px] font-normal">{t("detail.edit")}</h1>
      <PackagingForm
        initial={{
          id: item.id,
          name: item.name,
          brand: item.brand ?? "",
          description: item.description ?? "",
          priceId: price?.id,
          price: price ? String(price.price_per_piece) : "",
          freeReason: price?.free_reason ?? "",
        }}
      />
    </div>
  );
}
