import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  SectionTabs,
  StatusBadge,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  type ApprovalStatus,
} from "@/components/materials/ui";
import { MaterialTable } from "@/components/materials/MaterialTable";
import { SORT_KEYS, filtersFromSearch, type MaterialRow, type SortKey } from "@/lib/materials/table";
import { Link } from "@/i18n/navigation";
import { formatMoney, formatUnitCost } from "@/lib/materials/decimal";
import { getViewer } from "@/lib/materials/viewer";

const STATUSES: ApprovalStatus[] = ["DRAFT", "PENDING", "APPROVED", "RETURNED", "ARCHIVED"];

type Search = Record<string, string | undefined>;

const NO_BRAND = "__none__";

// Characters with meaning in a PostgREST filter are dropped from free text.
function cleanQuery(q: string | undefined) {
  return (q ?? "").replace(/[,()%*\\]/g, " ").trim();
}

function formatDate(value: string, locale: string) {
  return new Date(value).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function RawMaterialsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Search>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const search = await searchParams;
  const t = await getTranslations("RawMaterials");
  const { supabase, role } = await getViewer();

  if (role !== "ADMIN" && role !== "MANAGER") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-serif text-[32px] font-normal">{t("title")}</h1>
        <p className="rounded-[20px] bg-white p-6 text-sm text-[#3d3f3a]">{t("noAccess")}</p>
      </div>
    );
  }

  const tab = search.tab === "packaging" ? "packaging" : "materials";
  const q = cleanQuery(search.q);
  const status = STATUSES.includes(search.status as ApprovalStatus)
    ? (search.status as ApprovalStatus)
    : undefined;

  // Same groups as the approvals page: new items, plus packs and prices on approved items.
  const counts = await Promise.all([
    supabase.from("materials").select("id", { count: "exact", head: true }).eq("status", "PENDING"),
    supabase
      .from("material_packs")
      .select("id, materials!material_packs_material_id_fkey!inner(status)", { count: "exact", head: true })
      .eq("status", "PENDING")
      .eq("materials.status", "APPROVED"),
    supabase
      .from("material_price_versions")
      .select("id, material_packs!inner(status)", { count: "exact", head: true })
      .eq("status", "PENDING")
      .eq("material_packs.status", "APPROVED"),
    supabase
      .from("packaging_items")
      .select("id", { count: "exact", head: true })
      .eq("status", "PENDING"),
    supabase
      .from("packaging_prices")
      .select("id, packaging_items!inner(status)", { count: "exact", head: true })
      .eq("status", "PENDING")
      .eq("packaging_items.status", "APPROVED"),
    supabase
      .from("change_requests")
      .select("id", { count: "exact", head: true })
      .in("entity_type", ["MATERIAL", "PACKAGING_ITEM"])
      .eq("status", "PENDING"),
  ]);
  const waiting = counts.reduce((sum, { count }) => sum + (count ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-serif text-[32px] font-normal">{t("title")}</h1>
          <p className="text-sm text-[#3d3f3a]">{t("intro")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {role === "ADMIN" && (
            <Link href="/raw-materials/approvals" className={secondaryButtonClass}>
              {t("approvals")}
              {waiting > 0 && (
                <span className="ml-2 rounded-full bg-brand-orange px-2 text-xs">{waiting}</span>
              )}
            </Link>
          )}
          <a href={`/${locale}/raw-materials/export?tab=${tab}`} className={secondaryButtonClass}>
            {t("export")}
          </a>
          <Link href={`/raw-materials/import?tab=${tab}`} className={secondaryButtonClass}>
            {t("import.open")}
          </Link>
          <Link
            href={tab === "packaging" ? "/raw-materials/packaging/new" : "/raw-materials/new"}
            className={primaryButtonClass}
          >
            {tab === "packaging" ? t("newPackaging") : t("newMaterial")}
          </Link>
        </div>
      </div>

      <SectionTabs active={tab} />

      {tab === "materials" ? (
        <MaterialList locale={locale} search={search} />
      ) : (
        <PackagingList locale={locale} q={q} status={status} />
      )}
    </div>
  );
}

async function MaterialList({ locale, search }: { locale: string; search: Search }) {
  const t = await getTranslations("RawMaterials");
  const { supabase } = await getViewer();

  const { data: types } = await supabase
    .from("material_types")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order");

  // All materials are loaded; sorting and filtering happen in the table itself.
  const { data: materials } = await supabase
    .from("materials")
    .select(
      "id, name, brand, no_brand, status, updated_at, material_type_id, cost_pack_id, material_types(name), material_packs!material_packs_material_id_fkey(id, pack_quantity, unit, status)",
    )
    .order("name");

  const ids = (materials ?? []).map((m) => m.id);
  const { data: costs } = ids.length
    ? await supabase.from("material_current_costs").select("material_id, unit, unit_cost").in("material_id", ids)
    : { data: [] };
  const costById = new Map((costs ?? []).map((c) => [c.material_id, c]));

  const rows: MaterialRow[] = (materials ?? []).map((m) => {
    const packs = m.material_packs.filter((p) => p.status !== "ARCHIVED");
    const mainPack = packs.find((p) => p.id === m.cost_pack_id) ?? packs[0];
    const cost = costById.get(m.id);
    return {
      id: m.id,
      name: m.name,
      brand: m.no_brand ? t("noBrand") : (m.brand ?? ""),
      brandKey: m.no_brand ? NO_BRAND : (m.brand ?? ""),
      typeId: m.material_type_id ?? "",
      type: m.material_types?.name ?? "",
      status: m.status,
      updated: formatDate(m.updated_at, locale),
      updatedDay: new Date(m.updated_at).toLocaleDateString("en-CA"),
      updatedAt: m.updated_at,
      pack: mainPack ? `${Number(mainPack.pack_quantity)} ${mainPack.unit}` : "—",
      packQuantity: mainPack ? Number(mainPack.pack_quantity) : null,
      packUnit: mainPack?.unit ?? "",
      extraPacks: Math.max(packs.length - 1, 0),
      unitCost:
        cost?.unit_cost != null ? `RM${formatUnitCost(cost.unit_cost)} / ${cost.unit}` : null,
      unitCostValue: cost?.unit_cost != null ? Number(cost.unit_cost) : null,
    };
  });

  const brands = [...new Map(rows.map((row) => [row.brandKey, row.brand])).entries()]
    .filter(([key]) => key !== "")
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const units = [...new Set(rows.map((row) => row.packUnit).filter(Boolean))].sort();

  const sort = SORT_KEYS.includes(search.sort as SortKey) ? (search.sort as SortKey) : "name";
  const dir = search.dir === "desc" ? "desc" : "asc";

  return (
    <MaterialTable
      rows={rows}
      types={types ?? []}
      brands={brands}
      units={units}
      initialFilters={filtersFromSearch(search)}
      initialSort={sort}
      initialDir={dir}
    />
  );
}

async function StatusSelect({ status }: { status?: ApprovalStatus }) {
  const t = await getTranslations("RawMaterials");
  return (
    <select name="status" defaultValue={status ?? ""} aria-label={t("statusLabel")} className={inputClass}>
      <option value="">{t("allStatuses")}</option>
      {STATUSES.map((value) => (
        <option key={value} value={value}>
          {t(`status.${value}`)}
        </option>
      ))}
    </select>
  );
}

async function PackagingList({
  locale,
  q,
  status,
}: {
  locale: string;
  q: string;
  status?: ApprovalStatus;
}) {
  const t = await getTranslations("RawMaterials");
  const { supabase } = await getViewer();

  let query = supabase
    .from("packaging_items")
    .select("id, name, brand, status, updated_at, packaging_prices(price_per_piece, status)")
    .order("name");
  if (q) query = query.or(`name.ilike.%${q}%,brand.ilike.%${q}%`);
  if (status) query = query.eq("status", status);
  else query = query.neq("status", "ARCHIVED");
  const { data: items } = await query;

  const rows = (items ?? []).map((item) => {
    const current = item.packaging_prices.find((p) => p.status === "APPROVED");
    return {
      id: item.id,
      name: item.name,
      brand: item.brand ?? "",
      status: item.status,
      updated: formatDate(item.updated_at, locale),
      price: current ? `RM${formatMoney(current.price_per_piece)} / ${t("piece")}` : null,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <form className="grid gap-3 sm:grid-cols-[1fr_auto_auto]" role="search">
        <input type="hidden" name="tab" value="packaging" />
        <label className="sr-only" htmlFor="q">
          {t("search")}
        </label>
        <input id="q" name="q" defaultValue={q} placeholder={t("searchPlaceholder")} className={inputClass} />
        <StatusSelect status={status} />
        <button type="submit" className={secondaryButtonClass}>
          {t("filter")}
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-[20px] bg-white p-6 text-sm text-[#3d3f3a]">{t("emptyPackaging")}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/raw-materials/packaging/${row.id}`}
                className="flex h-full flex-col gap-2 rounded-[20px] bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="font-semibold">{row.name}</span>
                    {row.brand && <span className="text-sm text-[#3d3f3a]">{row.brand}</span>}
                  </div>
                  <StatusBadge status={row.status} />
                </div>
                <span className="font-semibold tabular-nums">{row.price ?? t("noApprovedCost")}</span>
                <span className="text-xs text-[#3d3f3a]">
                  {t("updated")} {row.updated}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
