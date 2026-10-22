import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  SectionTabs,
  StatusBadge,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  type ApprovalStatus,
} from "@/components/materials/ui";
import { Link } from "@/i18n/navigation";
import { formatMoney, formatUnitCost } from "@/lib/materials/decimal";
import { getViewer } from "@/lib/materials/viewer";

const STATUSES: ApprovalStatus[] = ["DRAFT", "PENDING", "APPROVED", "RETURNED", "ARCHIVED"];

type Search = { tab?: string; q?: string; type?: string; status?: string };

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
        <MaterialList locale={locale} q={q} type={search.type} status={status} />
      ) : (
        <PackagingList locale={locale} q={q} status={status} />
      )}
    </div>
  );
}

async function MaterialList({
  locale,
  q,
  type,
  status,
}: {
  locale: string;
  q: string;
  type?: string;
  status?: ApprovalStatus;
}) {
  const t = await getTranslations("RawMaterials");
  const { supabase } = await getViewer();

  const { data: types } = await supabase
    .from("material_types")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order");

  let query = supabase
    .from("materials")
    .select(
      "id, name, brand, no_brand, status, updated_at, cost_pack_id, material_types(name), material_packs!material_packs_material_id_fkey(id, pack_quantity, unit, status)",
    )
    .order("name");
  if (q) query = query.or(`name.ilike.%${q}%,brand.ilike.%${q}%`);
  if (type) query = query.eq("material_type_id", type);
  if (status) query = query.eq("status", status);
  else query = query.neq("status", "ARCHIVED");
  const { data: materials } = await query;

  const ids = (materials ?? []).map((m) => m.id);
  const { data: costs } = ids.length
    ? await supabase.from("material_current_costs").select("material_id, unit, unit_cost").in("material_id", ids)
    : { data: [] };
  const costById = new Map((costs ?? []).map((c) => [c.material_id, c]));

  const rows = (materials ?? []).map((m) => {
    const packs = m.material_packs.filter((p) => p.status !== "ARCHIVED");
    const mainPack = packs.find((p) => p.id === m.cost_pack_id) ?? packs[0];
    const cost = costById.get(m.id);
    return {
      id: m.id,
      name: m.name,
      brand: m.no_brand ? t("noBrand") : (m.brand ?? ""),
      type: m.material_types?.name ?? "",
      status: m.status,
      updated: formatDate(m.updated_at, locale),
      pack: mainPack ? `${Number(mainPack.pack_quantity)} ${mainPack.unit}` : "—",
      extraPacks: Math.max(packs.length - 1, 0),
      unitCost:
        cost?.unit_cost != null ? `RM${formatUnitCost(cost.unit_cost)} / ${cost.unit}` : null,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <form className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]" role="search">
        <label className="sr-only" htmlFor="q">
          {t("search")}
        </label>
        <input id="q" name="q" defaultValue={q} placeholder={t("searchPlaceholder")} className={inputClass} />
        <select name="type" defaultValue={type ?? ""} aria-label={t("type")} className={inputClass}>
          <option value="">{t("allTypes")}</option>
          {(types ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <StatusSelect status={status} />
        <button type="submit" className={secondaryButtonClass}>
          {t("filter")}
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-[20px] bg-white p-6 text-sm text-[#3d3f3a]">{t("empty")}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3 md:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/raw-materials/${row.id}`}
                  className="flex flex-col gap-2 rounded-[20px] bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="font-semibold">{row.name}</span>
                      <span className="text-sm text-[#3d3f3a]">
                        {row.brand} · {row.type}
                      </span>
                    </div>
                    <StatusBadge status={row.status} />
                  </div>
                  <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
                    <span>
                      {row.pack}
                      {row.extraPacks > 0 && ` +${row.extraPacks}`}
                    </span>
                    <span className="font-semibold tabular-nums">
                      {row.unitCost ?? t("noApprovedCost")}
                    </span>
                  </div>
                  <span className="text-xs text-[#3d3f3a]">
                    {t("updated")} {row.updated}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-[20px] bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-black/15 text-[#3d3f3a]">
                <tr>
                  <th className="px-5 py-3 font-semibold">{t("name")}</th>
                  <th className="px-5 py-3 font-semibold">{t("brand")}</th>
                  <th className="px-5 py-3 font-semibold">{t("type")}</th>
                  <th className="px-5 py-3 font-semibold">{t("mainPack")}</th>
                  <th className="px-5 py-3 text-right font-semibold">{t("unitCost")}</th>
                  <th className="px-5 py-3 font-semibold">{t("statusLabel")}</th>
                  <th className="px-5 py-3 font-semibold">{t("updated")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-black/10 last:border-0">
                    <td className="px-5 py-3">
                      <Link href={`/raw-materials/${row.id}`} className="font-semibold underline">
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3">{row.brand}</td>
                    <td className="px-5 py-3">{row.type}</td>
                    <td className="px-5 py-3">
                      {row.pack}
                      {row.extraPacks > 0 && (
                        <span className="text-[#3d3f3a]"> +{row.extraPacks}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {row.unitCost ?? <span className="text-[#3d3f3a]">{t("noApprovedCost")}</span>}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">{row.updated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
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
