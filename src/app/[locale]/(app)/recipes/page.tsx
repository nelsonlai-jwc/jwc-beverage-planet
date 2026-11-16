import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { getOutlets, getViewer, signPhotos } from "@/lib/recipes/data";
import { RECIPE_OUTLETS, canManageRecipe, coversOutlet, outletLabel, type RecipeOutlets } from "@/lib/recipes/outlets";
import type { ApprovalStatus } from "@/lib/recipes/types";
import { createClient } from "@/lib/supabase/server";
import { CatalogueGrid } from "@/components/recipes/CatalogueGrid";
import { TranslationNote } from "@/components/content/TranslationNote";
import { getLocalizer } from "@/lib/content/translations";
import { CATALOGUE_STYLES, catalogueStateFromSearch, type CatalogueCard } from "@/lib/recipes/catalogue";
import { addedStyles, getOptionLabels } from "@/lib/settings/options";
import { MineList } from "@/components/recipes/MineList";
import { RememberListFilters } from "@/components/recipes/RememberListFilters";
import { MINE_STATUSES, mineStateFromSearch, type MineCard } from "@/lib/recipes/mine";
import { TagList, card, inputClass, primaryButton, secondaryButton } from "@/components/recipes/ui";

type Tab = "mine" | "pending" | "catalogue";
const OPEN: ApprovalStatus[] = ["DRAFT", "PENDING", "RETURNED"];

export default async function RecipesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
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
  const outletName = (r: RecipeOutlets) => outletLabel(r, outlets, t("allOutletsOption"));
  const isStaff = viewer.role === "BARISTA";
  const tabs: Tab[] = isStaff ? [] : viewer.role === "ADMIN" ? ["mine", "pending", "catalogue"] : ["mine", "catalogue"];
  const tab: Tab = tabs.includes(query.tab as Tab) ? (query.tab as Tab) : "mine";
  const search = (query.q ?? "").trim().toLowerCase();

  // Every recipe this viewer can read, with its versions (RLS decides which).
  const { data: recipes } = await supabase
    .from("recipes")
    .select(`id, outlet_id, is_prep, status, current_approved_version_id, updated_at, ${RECIPE_OUTLETS}`)
    .order("updated_at", { ascending: false });
  const recipeIds = (recipes ?? []).map((r) => r.id);
  const { data: versions } = recipeIds.length
    ? await supabase
        .from("recipe_versions")
        .select("id, recipe_id, version_no, status, product_name, purpose, style, temperature, tags, submitted_at, updated_at")
        .in("recipe_id", recipeIds)
        .order("version_no", { ascending: false })
    : { data: [] };

  const base = (recipes ?? []).map((r) => {
    const own = (versions ?? []).filter((v) => v.recipe_id === r.id);
    const approved = own.find((v) => v.id === r.current_approved_version_id) ?? null;
    const open = own.find((v) => OPEN.includes(v.status)) ?? null;
    const neverSubmitted = !approved && own.every((v) => v.status === "DRAFT");
    return { ...r, approved, open, neverSubmitted, sourceName: (approved ?? open ?? own[0])?.product_name ?? null };
  });
  // Names in the viewer's language (AI translated); search still matches the original names.
  const loc = await getLocalizer(
    [...base.map((r) => r.sourceName), ...base.flatMap((r) => [...(r.approved?.tags ?? []), ...(r.open?.tags ?? [])])],
    locale,
  );
  const rows = base.map((r) => ({ ...r, name: loc.t(r.sourceName) ?? t("untitled") }));
  const tagsOf = (v: { tags: string[] } | null | undefined) => (v?.tags ?? []).map((tag) => loc.t(tag));
  const matches = (r: { sourceName: string | null }) => !search || (r.sourceName ?? "").toLowerCase().includes(search);
  const translationNote = <TranslationNote entries={loc.shown()} canEdit={viewer.role === "ADMIN"} />;

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[32px] font-normal">{nav("recipes")}</h1>
        <p className="text-sm text-[#3d3f3a]">{isStaff ? t("staffIntro") : t("intro")}</p>
      </div>
      {!isStaff && (
        <div className="flex flex-wrap gap-2">
          <a href={`/${locale}/recipes/export`} className={secondaryButton}>
            {t("exportCsv")}
          </a>
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
    // Keyed by the URL so remembered filters put back by RememberListFilters show in the inputs.
    <form key={JSON.stringify(query)} className="flex flex-wrap gap-2" action="">
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
    const visible = rows.filter((r) => r.approved && matches(r));
    const photos = await firstPhotos(supabase, visible.map((r) => r.approved!.id));
    return (
      <div className="flex flex-col gap-6">
        {header}
        {translationNote}
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
                  <TagList tags={tagsOf(r.approved)} />
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

  // Admin: open recipe change requests, listed on the pending tab and counted on its badge.
  const { data: archiveRequests } =
    viewer.role === "ADMIN"
      ? await supabase
          .from("change_requests")
          .select("id, entity_id, reason, created_at")
          .eq("entity_type", "RECIPE")
          .eq("status", "PENDING")
          .order("created_at")
      : { data: [] };
  const pendingCount =
    rows.filter((r) => r.open?.status === "PENDING").length + (archiveRequests ?? []).length;
  // Right after an approve/return decision: nothing left to review, so go to the recipe home.
  if (tab === "pending" && query.after === "review" && pendingCount === 0) redirect({ href: "/recipes", locale });

  const tabBar = (
    <nav aria-label={t("tabsLabel")} className="flex flex-wrap gap-1">
      <RememberListFilters tab={tab} />
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
          {key === "pending" && pendingCount > 0 && (
            <span
              aria-label={t("pendingCount", { count: pendingCount })}
              className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ff6062] px-1.5 align-middle text-xs font-semibold leading-none text-white"
            >
              {pendingCount > 99 ? "99+" : pendingCount}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );

  if (tab === "pending") {
    const pendingOutlet = outlets.some((o) => o.id === query.outlet) ? query.outlet : undefined;
    const keep = (r: (typeof rows)[number]) => matches(r) && (!pendingOutlet || coversOutlet(r, pendingOutlet));
    const pending = rows.filter((r) => r.open?.status === "PENDING" && keep(r));
    const recipeById = new Map(rows.map((r) => [r.id, r]));
    // The badge keeps the full count; the filters only narrow what is listed.
    const requests = (archiveRequests ?? []).filter((request) => {
      const r = recipeById.get(request.entity_id);
      return r ? keep(r) : !search && !pendingOutlet;
    });
    const filtered = Boolean(search || pendingOutlet);
    // Carried into the review page so Approve / Return come back to the same filters.
    const filterQuery = new URLSearchParams({
      ...(query.q?.trim() ? { q: query.q.trim() } : {}),
      ...(pendingOutlet ? { outlet: pendingOutlet } : {}),
    }).toString();
    return (
      <div className="flex flex-col gap-6">
        {header}
        {translationNote}
        {tabBar}
        {searchBox(
          <label className="basis-48">
            <span className="sr-only">{t("outlet")}</span>
            <select name="outlet" defaultValue={pendingOutlet ?? ""} className={inputClass}>
              <option value="">{t("allOutletsOption")}</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>,
        )}
        {requests.length > 0 && (
          <section className="flex flex-col gap-3" aria-labelledby="archive-requests">
            <h2 id="archive-requests" className="text-base font-semibold">
              {t("archive.requestsTitle")}
            </h2>
            <ul className="flex flex-col gap-3">
              {requests.map((request) => {
                const r = recipeById.get(request.entity_id);
                return (
                  <li key={request.id}>
                    <Link
                      href={`/recipes/${request.entity_id}`}
                      className={`${card} flex-row flex-wrap items-center justify-between hover:ring-2 hover:ring-black`}
                    >
                      <span className="flex flex-col gap-1">
                        <span className="text-base font-semibold">{r?.name ?? t("untitled")}</span>
                        <span className="text-sm text-[#3d3f3a]">
                          {r ? outletName(r) : "—"} · {request.reason}
                        </span>
                      </span>
                      <span className="text-sm font-semibold underline">{t("review")}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {pending.length === 0 && requests.length > 0 ? null : pending.length === 0 ? (
          <p className={card}>{filtered ? t("mineEmpty") : t("pendingEmpty")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((r) => (
              <li key={r.id}>
                <Link href={`/recipes/${r.id}/review${filterQuery ? `?${filterQuery}` : ""}`} className={`${card} flex-row flex-wrap items-center justify-between hover:ring-2 hover:ring-black`}>
                  <span className="flex flex-col gap-1">
                    <span className="text-base font-semibold">{r.name}</span>
                    <span className="text-sm text-[#3d3f3a]">
                      {outletName(r)} · V{r.open!.version_no} · {r.is_prep ? t("prep") : t("drink")}
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
    const catalogue = rows.filter((r) => r.approved && r.status === "ACTIVE" && matches(r));
    const photos = await firstPhotos(supabase, catalogue.map((r) => r.approved!.id));
    const cards: CatalogueCard[] = catalogue.map((r) => ({
      id: r.id,
      name: r.name,
      isPrep: r.is_prep,
      allOutlets: r.all_outlets,
      outletIds: r.recipe_outlets.map((o) => o.outlet_id),
      outlets: outletName(r),
      versionNo: r.approved!.version_no,
      purpose: r.approved!.purpose,
      style: r.approved!.style,
      temperature: r.approved!.temperature,
      photo: photos.get(r.approved!.id) ?? null,
      tags: tagsOf(r.approved),
    }));
    // Outlet chip: only outlets that at least one catalogue recipe covers.
    const outletOptions = outlets.filter((o) => catalogue.some((r) => coversOutlet(r, o.id)));
    const state = catalogueStateFromSearch(query);
    return (
      <div className="flex flex-col gap-6">
        {header}
        {translationNote}
        {tabBar}
        <p className="text-sm text-[#3d3f3a]">{t("catalogueNote")}</p>
        <CatalogueGrid
          key={JSON.stringify(state)}
          rows={cards}
          outlets={outletOptions}
          styles={[...CATALOGUE_STYLES, ...addedStyles(await getOptionLabels(), CATALOGUE_STYLES)]}
          search={query.q ?? ""}
          initialFilters={state.filters}
          initialSort={state.sort}
          initialDir={state.dir}
        />
      </div>
    );
  }

  // Recipes of the viewer's outlets (RLS leaves out the others); filters and sort run in MineList.
  const mine = rows.filter(matches);

  // Recipes whose deletion already waits for Admin show no delete button.
  const { data: pendingArchives } = mine.length
    ? await supabase
        .from("change_requests")
        .select("entity_id")
        .eq("entity_type", "RECIPE")
        .eq("action", "ARCHIVE")
        .eq("status", "PENDING")
        .in("entity_id", mine.map((r) => r.id))
    : { data: [] };
  const archivePending = new Set((pendingArchives ?? []).map((c) => c.entity_id));

  const mineCards: MineCard[] = mine.map((r) => {
    const shownVersion = r.open ?? r.approved;
    return {
      id: r.id,
      name: r.name,
      tags: tagsOf(shownVersion),
      archived: r.status === "ARCHIVED",
      isPrep: r.is_prep,
      allOutlets: r.all_outlets,
      outletIds: r.recipe_outlets.map((o) => o.outlet_id),
      outlets: outletName(r),
      updatedAt: r.updated_at,
      approvedNo: r.approved?.version_no ?? null,
      open: r.open ? { id: r.open.id, status: r.open.status, versionNo: r.open.version_no } : null,
      purpose: shownVersion?.purpose ?? null,
      style: shownVersion?.style ?? null,
      temperature: shownVersion?.temperature ?? null,
      neverSubmitted: r.neverSubmitted,
      canManage: canManageRecipe(viewer, r),
      archivePending: archivePending.has(r.id),
      archiveMode: viewer.role === "ADMIN" || !r.approved ? "archive" : "request",
    };
  });
  const mineState = mineStateFromSearch(query);
  // A saved outlet filter only counts for an outlet the viewer still manages.
  if (!viewer.managedOutletIds.includes(mineState.filters.outlet)) mineState.filters.outlet = "";
  if (!(MINE_STATUSES as readonly string[]).includes(mineState.filters.status)) mineState.filters.status = "";

  return (
    <div className="flex flex-col gap-6">
      {header}
      {translationNote}
      {tabBar}
      <MineList
        key={JSON.stringify(mineState)}
        rows={mineCards}
        outlets={outlets.filter((o) => viewer.managedOutletIds.includes(o.id))}
        styles={[...CATALOGUE_STYLES, ...addedStyles(await getOptionLabels(), CATALOGUE_STYLES)]}
        search={query.q ?? ""}
        initialFilters={mineState.filters}
        initialSort={mineState.sort}
        initialDir={mineState.dir}
      />
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
