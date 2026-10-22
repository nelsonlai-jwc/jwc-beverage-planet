import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getOutlets, getViewer, signPhotos } from "@/lib/recipes/data";
import type { ApprovalStatus } from "@/lib/recipes/types";
import { createClient } from "@/lib/supabase/server";
import { PurposeBadge, StatusBadge, card, inputClass, primaryButton, secondaryButton } from "@/components/recipes/ui";

type Tab = "mine" | "pending" | "catalogue";
const OPEN: ApprovalStatus[] = ["DRAFT", "PENDING", "RETURNED"];

export default async function RecipesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string; outlet?: string; status?: string; q?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const t = await getTranslations("Recipes");
  const nav = await getTranslations("Nav");
  const supabase = await createClient();
  const viewer = await getViewer(supabase);

  if (!viewer) {
    return <p className={card}>{t("noAccess")}</p>;
  }

  const outlets = await getOutlets(supabase);
  const outletName = (id: string) => outlets.find((o) => o.id === id)?.name ?? "—";
  const isStaff = viewer.role === "BARISTA";
  const tabs: Tab[] = isStaff ? [] : viewer.role === "ADMIN" ? ["mine", "pending", "catalogue"] : ["mine", "catalogue"];
  const tab: Tab = tabs.includes(query.tab as Tab) ? (query.tab as Tab) : "mine";
  const search = (query.q ?? "").trim().toLowerCase();

  // Every recipe this viewer can read, with its versions (RLS decides which).
  const { data: recipes } = await supabase
    .from("recipes")
    .select("id, outlet_id, is_prep, status, current_approved_version_id, updated_at")
    .order("updated_at", { ascending: false });
  const recipeIds = (recipes ?? []).map((r) => r.id);
  const { data: versions } = recipeIds.length
    ? await supabase
        .from("recipe_versions")
        .select("id, recipe_id, version_no, status, product_name, purpose, style, temperature, submitted_at, updated_at")
        .in("recipe_id", recipeIds)
        .order("version_no", { ascending: false })
    : { data: [] };

  const rows = (recipes ?? []).map((r) => {
    const own = (versions ?? []).filter((v) => v.recipe_id === r.id);
    const approved = own.find((v) => v.id === r.current_approved_version_id) ?? null;
    const open = own.find((v) => OPEN.includes(v.status)) ?? null;
    return { ...r, approved, open, name: (approved ?? open ?? own[0])?.product_name ?? t("untitled") };
  });
  const matches = (name: string) => !search || name.toLowerCase().includes(search);

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[32px] font-normal">{nav("recipes")}</h1>
        <p className="text-sm text-[#3d3f3a]">{isStaff ? t("staffIntro") : t("intro")}</p>
      </div>
      {!isStaff && (
        <div className="flex flex-wrap gap-2">
          <Link href="/recipes?tab=catalogue" className={secondaryButton}>
            {t("copyApproved")}
          </Link>
          <Link href="/recipes/new" className={primaryButton}>
            {t("create")}
          </Link>
        </div>
      )}
    </div>
  );

  const searchBox = (extra?: React.ReactNode) => (
    <form className="flex flex-wrap gap-2" action="">
      {tab !== "mine" && <input type="hidden" name="tab" value={tab} />}
      <label className="min-w-0 flex-1 basis-56">
        <span className="sr-only">{t("search")}</span>
        <input name="q" defaultValue={query.q ?? ""} placeholder={t("search")} className={inputClass} />
      </label>
      {extra}
      <button className={secondaryButton}>{t("apply")}</button>
    </form>
  );

  // Staff: the official SOPs of their outlet's published menus.
  if (isStaff) {
    const visible = rows.filter((r) => r.approved && matches(r.name));
    const photos = await firstPhotos(supabase, visible.map((r) => r.approved!.id));
    return (
      <div className="flex flex-col gap-6">
        {header}
        {searchBox()}
        {visible.length === 0 ? (
          <p className={card}>{t("staffEmpty")}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((r) => (
              <li key={r.id}>
                <Link href={`/recipes/${r.id}`} className={`${card} h-full hover:ring-2 hover:ring-black`}>
                  <Thumb url={photos.get(r.approved!.id)} alt={r.name} />
                  <span className="text-base font-semibold">{r.name}</span>
                  <span className="text-sm text-[#3d3f3a]">
                    {[r.approved!.style && t(`style.${r.approved!.style}`), r.approved!.temperature && t(`temp.${r.approved!.temperature}`)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const tabBar = (
    <nav aria-label={t("tabsLabel")} className="flex flex-wrap gap-1">
      {tabs.map((key) => (
        <Link
          key={key}
          href={key === "mine" ? "/recipes" : `/recipes?tab=${key}`}
          aria-current={key === tab ? "page" : undefined}
          className={
            key === tab
              ? "rounded-full bg-black px-4 py-2 text-sm font-semibold text-white"
              : "rounded-full px-4 py-2 text-sm hover:bg-black/10"
          }
        >
          {t(`tabs.${key}`)}
        </Link>
      ))}
    </nav>
  );

  if (tab === "pending") {
    const pending = rows.filter((r) => r.open?.status === "PENDING" && matches(r.name));
    return (
      <div className="flex flex-col gap-6">
        {header}
        {tabBar}
        {pending.length === 0 ? (
          <p className={card}>{t("pendingEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((r) => (
              <li key={r.id}>
                <Link href={`/recipes/${r.id}/review`} className={`${card} flex-row flex-wrap items-center justify-between hover:ring-2 hover:ring-black`}>
                  <span className="flex flex-col gap-1">
                    <span className="text-base font-semibold">{r.name}</span>
                    <span className="text-sm text-[#3d3f3a]">
                      {outletName(r.outlet_id)} · V{r.open!.version_no} · {r.is_prep ? t("prep") : t("drink")}
                    </span>
                  </span>
                  <span className="text-sm font-semibold underline">{t("review")}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (tab === "catalogue") {
    const catalogue = rows.filter((r) => r.approved && r.status === "ACTIVE" && matches(r.name));
    const photos = await firstPhotos(supabase, catalogue.map((r) => r.approved!.id));
    return (
      <div className="flex flex-col gap-6">
        {header}
        {tabBar}
        <p className="text-sm text-[#3d3f3a]">{t("catalogueNote")}</p>
        {searchBox()}
        {catalogue.length === 0 ? (
          <p className={card}>{t("catalogueEmpty")}</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {catalogue.map((r) => (
              <li key={r.id} className={card}>
                <Thumb url={photos.get(r.approved!.id)} alt={r.name} />
                <div className="flex flex-col gap-1">
                  <span className="text-base font-semibold">{r.name}</span>
                  <span className="text-sm text-[#3d3f3a]">
                    {outletName(r.outlet_id)} · V{r.approved!.version_no}
                  </span>
                  <span className="text-sm text-[#3d3f3a]">
                    {[
                      r.approved!.style && t(`style.${r.approved!.style}`),
                      r.approved!.temperature && t(`temp.${r.approved!.temperature}`),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <PurposeBadge purpose={r.approved!.purpose} />
                  {r.is_prep && <span className="text-xs font-semibold">{t("prep")}</span>}
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Link href={`/recipes/${r.id}`} className={secondaryButton}>
                    {t("view")}
                  </Link>
                  <Link href={`/recipes/${r.id}/copy`} className={primaryButton}>
                    {t("copy")}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // Own outlets' recipes.
  const managed = rows.filter((r) => viewer.managedOutletIds.includes(r.outlet_id));
  const outletFilter = viewer.managedOutletIds.includes(query.outlet ?? "") ? query.outlet : undefined;
  const statusFilter = ["DRAFT", "PENDING", "RETURNED", "APPROVED"].includes(query.status ?? "") ? query.status : undefined;
  const mine = managed.filter(
    (r) =>
      matches(r.name) &&
      (!outletFilter || r.outlet_id === outletFilter) &&
      (!statusFilter || (statusFilter === "APPROVED" ? !r.open && r.approved : r.open?.status === statusFilter)),
  );

  return (
    <div className="flex flex-col gap-6">
      {header}
      {tabBar}
      {searchBox(
        <>
          <label className="basis-48">
            <span className="sr-only">{t("outlet")}</span>
            <select name="outlet" defaultValue={outletFilter ?? ""} className={inputClass}>
              <option value="">{t("allOutlets")}</option>
              {outlets
                .filter((o) => viewer.managedOutletIds.includes(o.id))
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="basis-40">
            <span className="sr-only">{t("statusLabel")}</span>
            <select name="status" defaultValue={statusFilter ?? ""} className={inputClass}>
              <option value="">{t("allStatuses")}</option>
              {(["DRAFT", "PENDING", "RETURNED", "APPROVED"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </>,
      )}
      {mine.length === 0 ? (
        <p className={card}>{t("mineEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {mine.map((r) => (
            <li key={r.id}>
              <Link href={`/recipes/${r.id}`} className={`${card} gap-2 hover:ring-2 hover:ring-black`}>
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-base font-semibold">{r.name}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {r.approved && <StatusBadge status="APPROVED" />}
                    {r.open && <StatusBadge status={r.open.status} />}
                  </span>
                </span>
                <span className="text-sm text-[#3d3f3a]">
                  {outletName(r.outlet_id)} · {r.is_prep ? t("prep") : t("drink")}
                  {r.approved && ` · ${t("approvedVersion", { no: r.approved.version_no })}`}
                  {r.open && ` · ${t("openVersion", { no: r.open.version_no })}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function firstPhotos(supabase: Awaited<ReturnType<typeof createClient>>, versionIds: string[]) {
  const result = new Map<string, string | null>();
  if (!versionIds.length) return result;
  const { data } = await supabase
    .from("recipe_media")
    .select("recipe_version_id, media_asset_id")
    .in("recipe_version_id", versionIds)
    .eq("sort_order", 1);
  const urls = await signPhotos(supabase, (data ?? []).map((m) => m.media_asset_id));
  for (const m of data ?? []) result.set(m.recipe_version_id, urls.get(m.media_asset_id) ?? null);
  return result;
}

function Thumb({ url, alt }: { url?: string | null; alt: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- signed storage URLs
    <img src={url} alt={alt} className="aspect-[4/3] w-full rounded-[12px] object-cover" />
  ) : (
    <div className="aspect-[4/3] w-full rounded-[12px] bg-[#eceee8]" aria-hidden />
  );
}
