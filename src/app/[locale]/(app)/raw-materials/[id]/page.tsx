import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AddPackForm } from "@/components/materials/AddPackForm";
import { DeleteButton, RestoreButton } from "@/components/materials/ItemActions";
import { ChangeRequestNotice, UsageSection } from "@/components/materials/ItemSections";
import {
  PriceChangeForm,
  ReviewActions,
  SubmitButton,
} from "@/components/materials/ReviewActions";
import {
  BackLink,
  StatusBadge,
  cardClass,
  secondaryButtonClass,
} from "@/components/materials/ui";
import { Link } from "@/i18n/navigation";
import { PriceComparison } from "@/components/materials/PriceComparison";
import { divide, formatMoney, formatUnitCost } from "@/lib/materials/decimal";
import { getViewer } from "@/lib/materials/viewer";
import { signedMediaUrl } from "@/lib/media/signedUrl";
import { proposeMaterialPrice, submitMaterial } from "../actions";

export default async function MaterialPage({
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

  const { data: material } = await supabase
    .from("materials")
    .select(
      "*, material_types(name), material_packs!material_packs_material_id_fkey(id, pack_quantity, unit, description, status, created_at, material_price_versions(id, price, free_reason, status, effective_from, created_at))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!material) notFound();

  const [{ data: affected }, { data: returns }] = await Promise.all([
    supabase.rpc("material_affected_recipe_count", { p_material_id: id }),
    supabase
      .from("approval_events")
      .select("reason, created_at")
      .eq("entity_type", "MATERIAL")
      .eq("entity_id", id)
      .eq("action", "RETURN")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const isAdmin = role === "ADMIN";
  const isOwner = isAdmin || material.created_by === userId;
  const editable = isOwner && (material.status === "DRAFT" || material.status === "RETURNED");
  const deleteMode =
    material.status === "DRAFT" && isOwner
      ? "delete"
      : material.status === "RETURNED" && isOwner
        ? "archive"
        : material.status === "APPROVED"
          ? isAdmin
            ? "archive"
            : "request"
          : null;
  const photoUrl = await signedMediaUrl(supabase, material.photo_asset_id);
  const packs = material.material_packs
    .filter((p) => p.status !== "ARCHIVED")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((pack) => {
      const prices = pack.material_price_versions;
      const current = prices.find((p) => p.status === "APPROVED");
      const proposed = prices.find((p) => p.status !== "APPROVED" && p.status !== "SUPERSEDED");
      return { ...pack, current, proposed };
    });

  const brand = material.no_brand ? t("noBrand") : material.brand;

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/raw-materials" label={t("title")} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-[32px] font-normal">{material.name}</h1>
            <StatusBadge status={material.status} />
          </div>
          <p className="text-sm text-[#3d3f3a]">
            {brand} · {material.material_types?.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(editable || material.status === "APPROVED") && (
            <Link href={`/raw-materials/${id}/edit`} className={secondaryButtonClass}>
              {t("detail.edit")}
            </Link>
          )}
          <Link href={`/raw-materials/${id}/history`} className={secondaryButtonClass}>
            {t("history.open")}
          </Link>
          {editable && <SubmitButton id={id} action={submitMaterial} />}
          {deleteMode && (
            <DeleteButton entity="MATERIAL" id={id} mode={deleteMode} listHref="/raw-materials" />
          )}
        </div>
      </div>

      {material.status === "ARCHIVED" && (
        <div role="status" className="flex flex-col gap-3 rounded-[20px] bg-white p-5">
          <p className="text-sm font-semibold">{t("remove.archivedTitle")}</p>
          <p className="text-[13px] text-[#3d3f3a]">{t("remove.archivedNote")}</p>
          {isAdmin && (
            <div className="self-start">
              <RestoreButton entity="MATERIAL" id={id} />
            </div>
          )}
        </div>
      )}
      <ChangeRequestNotice entity="MATERIAL" id={id} isAdmin={isAdmin} />

      {material.status === "RETURNED" && returns?.[0] && (
        <div role="status" className="rounded-[20px] border-[1.5px] border-brand-red bg-white p-5">
          <p className="text-sm font-semibold">{t("detail.returnedTitle")}</p>
          <p className="mt-1 text-sm">{returns[0].reason}</p>
        </div>
      )}
      {material.status === "PENDING" && (
        <div className="rounded-[20px] bg-white p-5">
          <p className="text-sm font-semibold">{t("detail.pendingTitle")}</p>
          <p className="mt-1 text-[13px] text-[#3d3f3a]">{t("detail.pendingNote")}</p>
          {isAdmin && (
            <div className="mt-4">
              <ReviewActions kind="material" id={id} />
            </div>
          )}
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className={cardClass} aria-labelledby="identity">
          <h2 id="identity" className="text-base font-semibold">
            {t("form.identity")}
          </h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label={t("form.name")} value={material.name} />
            <Detail label={t("form.brand")} value={brand} />
            <Detail label={t("form.type")} value={material.material_types?.name} />
            <Detail label={t("form.specification")} value={material.specification} />
            <Detail label={t("form.abv")} value={material.abv != null ? `${material.abv}%` : null} />
            <Detail label={t("form.bx")} value={material.bx != null ? `${material.bx}%` : null} />
            <Detail
              label={t("form.coffeeBean")}
              value={material.is_coffee_bean ? t("detail.yes") : t("detail.no")}
            />
            <Detail label={t("detail.usedBy")} value={t("detail.recipes", { count: affected ?? 0 })} />
          </dl>
          {material.description && <p className="text-sm whitespace-pre-line">{material.description}</p>}
          {photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
            <img src={photoUrl} alt={t("photo.alt")} className="h-48 w-48 rounded-[14px] object-cover" />
          )}
        </section>

        <section className={cardClass} aria-labelledby="packs">
          <h2 id="packs" className="text-base font-semibold">
            {t("form.packAndPrice")}
          </h2>
          {packs.length === 0 && <p className="text-sm text-[#3d3f3a]">{t("detail.noPacks")}</p>}
          <ul className="flex flex-col gap-4">
            {packs.map((pack) => {
              const quotient = pack.current
                ? divide(String(pack.current.price), String(pack.pack_quantity))
                : null;
              const unitCost = quotient && quotient !== "DIV_ZERO" ? formatUnitCost(quotient) : null;
              return (
                <li key={pack.id} className="flex flex-col gap-3 border-t border-black/10 pt-4 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold tabular-nums">
                      {pack.pack_quantity} {pack.unit}
                      {pack.description && (
                        <span className="font-normal text-[#3d3f3a]"> · {pack.description}</span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      {pack.id === material.cost_pack_id && (
                        <span className="rounded-full bg-brand-purple px-2.5 py-0.5 text-xs font-semibold text-white">
                          {t("detail.costPack")}
                        </span>
                      )}
                      <StatusBadge status={pack.status} />
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <Detail
                      label={t("detail.currentPrice")}
                      value={pack.current ? `RM${formatMoney(pack.current.price)}` : t("noApprovedCost")}
                    />
                    <Detail
                      label={t("unitCost")}
                      value={unitCost ? `RM${unitCost} / ${pack.unit}` : t("noApprovedCost")}
                    />
                  </dl>
                  {pack.current?.free_reason && (
                    <p className="text-[13px] text-[#3d3f3a]">
                      {t("form.freeReason")}: {pack.current.free_reason}
                    </p>
                  )}
                  {pack.proposed && (
                    <div className="flex flex-col gap-3 rounded-[14px] bg-brand-base/60 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{t("detail.proposedPrice")}</span>
                        <StatusBadge status={pack.proposed.status} />
                      </div>
                      <PriceComparison
                        oldPrice={pack.current?.price ?? null}
                        newPrice={pack.proposed.price}
                        unit={pack.unit}
                        quantity={pack.pack_quantity}
                        labels={{
                          old: t("priceChange.old"),
                          new: t("priceChange.new"),
                          change: t("priceChange.change"),
                        }}
                      />
                      {isAdmin && pack.proposed.status === "PENDING" && material.status === "APPROVED" && pack.status === "APPROVED" && (
                        <ReviewActions kind="price" id={pack.proposed.id} />
                      )}
                    </div>
                  )}
                  {isAdmin && pack.status === "PENDING" && material.status === "APPROVED" && (
                    <ReviewActions kind="pack" id={pack.id} />
                  )}
                  {material.status === "APPROVED" && pack.status === "APPROVED" && !pack.proposed && (
                    <PriceChangeForm
                      id={pack.id}
                      oldPrice={pack.current?.price ?? null}
                      affected={pack.id === material.cost_pack_id ? (affected ?? 0) : 0}
                      submit={proposeMaterialPrice}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {material.status === "APPROVED" && <AddPackForm materialId={id} />}
        </section>

        <UsageSection entity="MATERIAL" id={id} />
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[#3d3f3a]">{label}</dt>
      <dd className="font-semibold">{value || "—"}</dd>
    </div>
  );
}
