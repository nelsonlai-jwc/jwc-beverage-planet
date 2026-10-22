import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PriceComparison } from "@/components/materials/PriceComparison";
import { PriceChangeForm, ReviewActions, SubmitButton } from "@/components/materials/ReviewActions";
import { BackLink, StatusBadge, cardClass, secondaryButtonClass } from "@/components/materials/ui";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/materials/decimal";
import { getViewer } from "@/lib/materials/viewer";
import { proposePackagingPrice, submitPackagingItem } from "../../actions";

export default async function PackagingPage({
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
    .select("*, packaging_prices(id, price_per_piece, free_reason, status, created_at)")
    .eq("id", id)
    .maybeSingle();
  if (!item) notFound();

  const [{ data: affected }, { data: returns }] = await Promise.all([
    supabase.rpc("packaging_affected_recipe_count", { p_packaging_item_id: id }),
    supabase
      .from("approval_events")
      .select("reason")
      .eq("entity_type", "PACKAGING_ITEM")
      .eq("entity_id", id)
      .eq("action", "RETURN")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const isAdmin = role === "ADMIN";
  const editable = item.status === "DRAFT" || item.status === "RETURNED";
  const current = item.packaging_prices.find((p) => p.status === "APPROVED");
  const proposed = item.packaging_prices.find((p) => p.status !== "APPROVED" && p.status !== "SUPERSEDED");

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/raw-materials?tab=packaging" label={t("tabPackaging")} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-[32px] font-normal">{item.name}</h1>
            <StatusBadge status={item.status} />
          </div>
          {item.brand && <p className="text-sm text-[#3d3f3a]">{item.brand}</p>}
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Link href={`/raw-materials/packaging/${id}/edit`} className={secondaryButtonClass}>
              {t("detail.edit")}
            </Link>
            <SubmitButton id={id} action={submitPackagingItem} />
          </div>
        )}
      </div>

      {item.status === "RETURNED" && returns?.[0] && (
        <div role="status" className="rounded-[20px] border-[1.5px] border-brand-red bg-white p-5">
          <p className="text-sm font-semibold">{t("detail.returnedTitle")}</p>
          <p className="mt-1 text-sm">{returns[0].reason}</p>
        </div>
      )}
      {item.status === "PENDING" && (
        <div className="rounded-[20px] bg-white p-5">
          <p className="text-sm font-semibold">{t("detail.pendingTitle")}</p>
          {isAdmin && (
            <div className="mt-4">
              <ReviewActions kind="packaging" id={id} />
            </div>
          )}
        </div>
      )}

      <section className={`${cardClass} max-w-xl`} aria-labelledby="price">
        <h2 id="price" className="text-base font-semibold">
          {t("packaging.pricePerPiece")}
        </h2>
        <p className="text-lg font-semibold tabular-nums">
          {current ? `RM${formatMoney(current.price_per_piece)} / ${t("piece")}` : t("noApprovedCost")}
        </p>
        {current?.free_reason && (
          <p className="text-[13px] text-[#3d3f3a]">
            {t("form.freeReason")}: {current.free_reason}
          </p>
        )}
        <p className="text-sm text-[#3d3f3a]">{t("detail.recipes", { count: affected ?? 0 })}</p>
        {item.description && <p className="text-sm whitespace-pre-line">{item.description}</p>}
        {proposed && item.status === "APPROVED" && (
          <div className="flex flex-col gap-3 rounded-[14px] bg-brand-base/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">{t("detail.proposedPrice")}</span>
              <StatusBadge status={proposed.status} />
            </div>
            <PriceComparison
              oldPrice={current?.price_per_piece ?? null}
              newPrice={proposed.price_per_piece}
              unit={t("piece")}
              labels={{
                old: t("priceChange.old"),
                new: t("priceChange.new"),
                change: t("priceChange.change"),
              }}
            />
            {isAdmin && proposed.status === "PENDING" && (
              <ReviewActions kind="packagingPrice" id={proposed.id} />
            )}
          </div>
        )}
        {item.status === "APPROVED" && !proposed && (
          <PriceChangeForm
            id={id}
            oldPrice={current?.price_per_piece ?? null}
            affected={affected ?? 0}
            submit={proposePackagingPrice}
          />
        )}
      </section>
    </div>
  );
}
