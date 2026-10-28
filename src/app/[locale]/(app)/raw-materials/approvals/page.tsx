import { getTranslations, setRequestLocale } from "next-intl/server";
import { PriceComparison } from "@/components/materials/PriceComparison";
import { ChangeTable, describeChanges } from "@/components/materials/ItemSections";
import { ReviewActions } from "@/components/materials/ReviewActions";
import { BackLink, cardClass } from "@/components/materials/ui";
import { Link } from "@/i18n/navigation";
import { divide, formatMoney, formatUnitCost } from "@/lib/materials/decimal";
import { getViewer } from "@/lib/materials/viewer";

function unitCostText(price: number | undefined, quantity: number, unit: string) {
  if (price === undefined) return null;
  const value = divide(String(price), String(quantity));
  return value && value !== "DIV_ZERO" ? `RM${formatUnitCost(value)} / ${unit}` : null;
}

export default async function ApprovalsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("RawMaterials");
  const { supabase, role } = await getViewer();

  if (role !== "ADMIN") {
    return <p className="rounded-[20px] bg-white p-6 text-sm text-[#3d3f3a]">{t("noAccess")}</p>;
  }

  const [materials, packs, prices, packagingItems, packagingPrices, requests] = await Promise.all([
    supabase
      .from("materials")
      .select(
        "id, name, brand, no_brand, material_types(name), material_packs!material_packs_material_id_fkey(id, pack_quantity, unit, status, material_price_versions(price, free_reason, status))",
      )
      .eq("status", "PENDING")
      .order("updated_at"),
    supabase
      .from("material_packs")
      .select(
        "id, pack_quantity, unit, description, materials!material_packs_material_id_fkey!inner(id, name, brand, status), material_price_versions(price, status)",
      )
      .eq("status", "PENDING")
      .eq("materials.status", "APPROVED"),
    supabase
      .from("material_price_versions")
      .select(
        "id, price, free_reason, material_packs!inner(id, pack_quantity, unit, status, material_id, materials!material_packs_material_id_fkey(id, name, brand), material_price_versions(price, status))",
      )
      .eq("status", "PENDING")
      .eq("material_packs.status", "APPROVED"),
    supabase
      .from("packaging_items")
      .select("id, name, brand, packaging_prices(price_per_piece, free_reason, status)")
      .eq("status", "PENDING"),
    supabase
      .from("packaging_prices")
      .select(
        "id, price_per_piece, free_reason, packaging_items!inner(id, name, brand, status, packaging_prices(price_per_piece, status))",
      )
      .eq("status", "PENDING")
      .eq("packaging_items.status", "APPROVED"),
    supabase
      .from("change_requests")
      .select("id, entity_type, entity_id, action, changes, old_values, reason")
      .in("entity_type", ["MATERIAL", "PACKAGING_ITEM"])
      .eq("status", "PENDING")
      .order("created_at"),
  ]);

  const requestRows = await Promise.all(
    (requests.data ?? []).map(async (request) => {
      const entity = request.entity_type as "MATERIAL" | "PACKAGING_ITEM";
      const isMaterial = entity === "MATERIAL";
      const { data: item } = isMaterial
        ? await supabase.from("materials").select("name, brand").eq("id", request.entity_id).maybeSingle()
        : await supabase.from("packaging_items").select("name, brand").eq("id", request.entity_id).maybeSingle();
      return {
        ...request,
        title: item?.name ?? "",
        subtitle: item?.brand ?? "",
        href: isMaterial ? `/raw-materials/${request.entity_id}` : `/raw-materials/packaging/${request.entity_id}`,
        changes:
          request.action === "EDIT"
            ? await describeChanges(
                entity,
                request.old_values as Record<string, unknown> | null,
                request.changes as Record<string, unknown> | null,
              )
            : [],
      };
    }),
  );

  const priceRows = await Promise.all(
    (prices.data ?? []).map(async (row) => {
      const pack = row.material_packs;
      const { data: affected } = await supabase.rpc("material_affected_recipe_count", {
        p_material_id: pack.material_id,
      });
      return {
        ...row,
        pack,
        current: pack.material_price_versions.find((p) => p.status === "APPROVED")?.price ?? null,
        affected: affected ?? 0,
      };
    }),
  );
  const packagingPriceRows = await Promise.all(
    (packagingPrices.data ?? []).map(async (row) => {
      const item = row.packaging_items;
      const { data: affected } = await supabase.rpc("packaging_affected_recipe_count", {
        p_packaging_item_id: item.id,
      });
      return {
        ...row,
        item,
        current: item.packaging_prices.find((p) => p.status === "APPROVED")?.price_per_piece ?? null,
        affected: affected ?? 0,
      };
    }),
  );

  const labels = {
    old: t("priceChange.old"),
    new: t("priceChange.new"),
    change: t("priceChange.change"),
  };
  const total =
    (materials.data?.length ?? 0) +
    (packs.data?.length ?? 0) +
    priceRows.length +
    (packagingItems.data?.length ?? 0) +
    packagingPriceRows.length +
    requestRows.length;

  return (
    <div className="flex flex-col gap-6">
      <BackLink href="/raw-materials" label={t("title")} />
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[32px] font-normal">{t("approvals")}</h1>
        <p className="text-sm text-[#3d3f3a]">{t("approvalsIntro")}</p>
      </div>

      {total === 0 && (
        <p className="rounded-[20px] bg-white p-6 text-sm text-[#3d3f3a]">{t("approvalsEmpty")}</p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {(materials.data ?? []).map((material) => {
          const pack = material.material_packs.find((p) => p.status === "PENDING");
          const price = pack?.material_price_versions.find((p) => p.status === "PENDING");
          return (
            <article key={material.id} className={cardClass}>
              <Header
                kind={t("approvalKinds.material")}
                title={material.name}
                subtitle={material.no_brand ? t("noBrand") : (material.brand ?? "")}
                href={`/raw-materials/${material.id}`}
              />
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <Item label={t("form.type")} value={material.material_types?.name} />
                <Item label={t("form.pack")} value={pack ? `${pack.pack_quantity} ${pack.unit}` : null} />
                <Item
                  label={t("form.price")}
                  value={price ? `RM${formatMoney(price.price)}` : t("noApprovedCost")}
                />
              </dl>
              {pack && price && (
                <p className="text-sm">
                  {t("unitCost")}:{" "}
                  <span className="font-semibold tabular-nums">
                    {unitCostText(price.price, pack.pack_quantity, pack.unit)}
                  </span>
                </p>
              )}
              {price?.free_reason && (
                <p className="text-[13px] text-[#3d3f3a]">
                  {t("form.freeReason")}: {price.free_reason}
                </p>
              )}
              <ReviewActions kind="material" id={material.id} />
            </article>
          );
        })}

        {(packs.data ?? []).map((pack) => {
          const price = pack.material_price_versions.find((p) => p.status === "PENDING");
          return (
            <article key={pack.id} className={cardClass}>
              <Header
                kind={t("approvalKinds.pack")}
                title={pack.materials.name}
                subtitle={pack.materials.brand ?? ""}
                href={`/raw-materials/${pack.materials.id}`}
              />
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <Item label={t("form.pack")} value={`${pack.pack_quantity} ${pack.unit}`} />
                <Item label={t("form.price")} value={price ? `RM${formatMoney(price.price)}` : null} />
                <Item label={t("unitCost")} value={unitCostText(price?.price, pack.pack_quantity, pack.unit)} />
              </dl>
              <ReviewActions kind="pack" id={pack.id} />
            </article>
          );
        })}

        {priceRows.map((row) => (
          <article key={row.id} className={cardClass}>
            <Header
              kind={t("approvalKinds.price")}
              title={row.pack.materials.name}
              subtitle={`${row.pack.materials.brand ?? ""} · ${row.pack.pack_quantity} ${row.pack.unit}`}
              href={`/raw-materials/${row.pack.materials.id}`}
            />
            <PriceComparison
              oldPrice={row.current}
              newPrice={row.price}
              unit={row.pack.unit}
              quantity={row.pack.pack_quantity}
              labels={labels}
            />
            <p className="text-[13px] text-[#3d3f3a]">{t("priceChange.affected", { count: row.affected })}</p>
            <ReviewActions kind="price" id={row.id} />
          </article>
        ))}

        {(packagingItems.data ?? []).map((item) => {
          const price = item.packaging_prices.find((p) => p.status === "PENDING");
          return (
            <article key={item.id} className={cardClass}>
              <Header
                kind={t("approvalKinds.packaging")}
                title={item.name}
                subtitle={item.brand ?? ""}
                href={`/raw-materials/packaging/${item.id}`}
              />
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <Item
                  label={t("packaging.pricePerPiece")}
                  value={price ? `RM${formatMoney(price.price_per_piece)}` : t("noApprovedCost")}
                />
                <Item label={t("form.freeReason")} value={price?.free_reason} />
              </dl>
              <ReviewActions kind="packaging" id={item.id} />
            </article>
          );
        })}

        {packagingPriceRows.map((row) => (
          <article key={row.id} className={cardClass}>
            <Header
              kind={t("approvalKinds.packagingPrice")}
              title={row.item.name}
              subtitle={row.item.brand ?? ""}
              href={`/raw-materials/packaging/${row.item.id}`}
            />
            <PriceComparison
              oldPrice={row.current}
              newPrice={row.price_per_piece}
              unit={t("piece")}
              labels={labels}
            />
            <p className="text-[13px] text-[#3d3f3a]">{t("priceChange.affected", { count: row.affected })}</p>
            <ReviewActions kind="packagingPrice" id={row.id} />
          </article>
        ))}

        {requestRows.map((row) => (
          <article key={row.id} className={cardClass}>
            <Header
              kind={row.action === "EDIT" ? t("approvalKinds.edit") : t("approvalKinds.archive")}
              title={row.title}
              subtitle={row.subtitle}
              href={row.href}
            />
            {row.changes.length > 0 && <ChangeTable changes={row.changes} />}
            {row.reason && (
              <p className="text-sm">
                {t("requests.reason")}: {row.reason}
              </p>
            )}
            <ReviewActions kind="change" id={row.id} />
          </article>
        ))}
      </div>
    </div>
  );
}

function Header({
  kind,
  title,
  subtitle,
  href,
}: {
  kind: string;
  title: string;
  subtitle: string;
  href: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="self-start rounded-full bg-brand-orange px-2.5 py-0.5 text-xs font-semibold">{kind}</span>
      <Link href={href} className="text-base font-semibold underline">
        {title}
      </Link>
      {subtitle && <span className="text-sm text-[#3d3f3a]">{subtitle}</span>}
    </div>
  );
}

function Item({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[#3d3f3a]">{label}</dt>
      <dd className="font-semibold tabular-nums">{value || "—"}</dd>
    </div>
  );
}
