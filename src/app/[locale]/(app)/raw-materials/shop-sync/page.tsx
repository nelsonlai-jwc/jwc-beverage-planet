import { getTranslations, setRequestLocale } from "next-intl/server";
import { ShopSyncForm } from "@/components/materials/ShopSyncForm";
import { BackLink, cardClass, errorClass } from "@/components/materials/ui";
import { getViewer } from "@/lib/materials/viewer";
import { loadShopPlan } from "./actions";

/** Super Admin: preview of the coffee beans on the JWC shop, then import / sync. */
export default async function ShopSyncPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("RawMaterials");
  const { role } = await getViewer();
  if (role !== "ADMIN") {
    return <p className="rounded-[20px] bg-white p-6 text-sm text-[#3d3f3a]">{t("noAccess")}</p>;
  }
  const result = await loadShopPlan();

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/raw-materials" label={t("backToList")} />
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[26px] font-normal leading-tight md:text-[28px]">{t("shopSync.title")}</h1>
        <p className="text-sm text-[#3d3f3a]">{t("shopSync.intro")}</p>
      </div>
      {result.ok ? (
        <ShopSyncForm plan={result.plan} />
      ) : (
        <p role="alert" className={`${cardClass} ${errorClass}`}>
          {t(`shopSync.errors.${result.error === "NOT_ALLOWED" ? "NOT_ALLOWED" : "SHOP_UNREACHABLE"}`)}
        </p>
      )}
    </div>
  );
}
