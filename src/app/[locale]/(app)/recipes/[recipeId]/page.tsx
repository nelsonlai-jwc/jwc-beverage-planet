import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getOutlets, getRecipeCost, getViewer, loadFullVersion } from "@/lib/recipes/data";
import { formatDateTime, toSopData } from "@/lib/recipes/format";
import { createClient } from "@/lib/supabase/server";
import { ReviewActions as ChangeReview } from "@/components/materials/ReviewActions";
import { CostSummary } from "@/components/recipes/CostSummary";
import { ArchiveRecipeButton, RestoreRecipeButton } from "@/components/recipes/RecipeRemove";
import { SopView } from "@/components/recipes/SopView";
import { VersionActions } from "@/components/recipes/VersionActions";
import { PurposeBadge, StatusBadge, card, primaryButton } from "@/components/recipes/ui";

export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ locale: string; recipeId: string }>;
}) {
  const { locale, recipeId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Recipes");
  const supabase = await createClient();
  const viewer = await getViewer(supabase);

  const { data: recipe } = await supabase.from("recipes").select("*").eq("id", recipeId).maybeSingle();
  if (!viewer || !recipe) notFound();

  const outlets = await getOutlets(supabase);
  const outletName = outlets.find((o) => o.id === recipe.outlet_id)?.name ?? "—";
  const canManage = viewer.managedOutletIds.includes(recipe.outlet_id);

  const { data: versions } = await supabase
    .from("recipe_versions")
    .select("id, version_no, status, product_name, purpose, submitted_by, submitted_at, approved_at, updated_at")
    .eq("recipe_id", recipeId)
    .order("version_no", { ascending: false });
  const open = (versions ?? []).find((v) => ["DRAFT", "PENDING", "RETURNED"].includes(v.status)) ?? null;
  const approved = recipe.current_approved_version_id
    ? await loadFullVersion(supabase, recipe.current_approved_version_id)
    : null;
  const approvedMeta = (versions ?? []).find((v) => v.id === recipe.current_approved_version_id);

  const [events, provenance, menus, cost, requests] = canManage
    ? await Promise.all([
        supabase
          .from("approval_events")
          .select("id, entity_id, action, reason, created_at")
          .eq("entity_type", "RECIPE_VERSION")
          .in("entity_id", (versions ?? []).map((v) => v.id))
          .order("created_at", { ascending: false }),
        supabase.from("recipe_copy_provenance").select("source_recipe_id, source_outlet_id, copied_at").eq("target_recipe_id", recipeId).maybeSingle(),
        supabase.from("menu_items").select("menu_id, menus!inner(name, status)").eq("recipe_id", recipeId),
        approved ? getRecipeCost(supabase, approved.id) : Promise.resolve(null),
        supabase
          .from("change_requests")
          .select("id, action, status, reason, review_reason, requested_by")
          .eq("entity_type", "RECIPE")
          .eq("entity_id", recipeId)
          .eq("action", "ARCHIVE")
          .order("created_at", { ascending: false })
          .limit(1),
      ])
    : [null, null, null, null, null];

  const archived = recipe.status === "ARCHIVED";
  const request = requests?.data?.[0];
  const pendingArchive = request?.status === "PENDING" ? request : null;
  const returnedArchive = request?.status === "RETURNED" && request.requested_by === viewer.id ? request : null;
  // Never submitted: really deleted with the draft (VersionActions). Otherwise archived.
  const neverSubmitted = !approved && (versions ?? []).every((v) => v.status === "DRAFT");
  const archiveMode = viewer.role === "ADMIN" || !approved ? "archive" : "request";

  const returnReason =
    open?.status === "RETURNED"
      ? (events?.data ?? []).find((e) => e.entity_id === open.id && e.action === "RETURN")?.reason
      : null;
  const name = approved?.product_name ?? open?.product_name ?? t("untitled");
  const versionNo = (id: string) => (versions ?? []).find((v) => v.id === id)?.version_no;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/recipes" className="text-sm underline">
          {t("backToList")}
        </Link>
        <h1 className="font-serif text-[32px] font-normal">{name}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-[#3d3f3a]">
          <span>{outletName}</span>
          <span>·</span>
          <span>{recipe.is_prep ? t("prep") : t("drink")}</span>
          {approved && <PurposeBadge purpose={approved.purpose} />}
        </p>
        {archived && (
          <div role="status" className="flex flex-col gap-2 rounded-[20px] border-[1.5px] border-black bg-white p-5">
            <p className="text-sm font-semibold">{t("archive.archivedTitle")}</p>
            <p className="text-sm">{t("archive.archivedNote")}</p>
            {viewer.role === "ADMIN" && <RestoreRecipeButton recipeId={recipe.id} />}
          </div>
        )}
        {provenance?.data && (
          <p className="text-sm">
            {t("copiedFrom", {
              outlet: outlets.find((o) => o.id === provenance.data!.source_outlet_id)?.name ?? "—",
              date: formatDateTime(provenance.data.copied_at, locale),
            })}
          </p>
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="flex flex-col gap-4">
          {approved ? (
            <SopView data={toSopData(approved, formatDateTime(approvedMeta?.approved_at, locale))} />
          ) : (
            <p className={card}>{t("noApprovedYet")}</p>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          {canManage && (
            <section className={card}>
              <h2 className="text-base font-semibold">{t("versionPanel")}</h2>
              {open ? (
                <div className="flex flex-col gap-2 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">V{open.version_no}</span>
                    <StatusBadge status={open.status} />
                  </p>
                  {open.status === "PENDING" && <p>{t("pendingNote", { date: formatDateTime(open.submitted_at, locale) })}</p>}
                  {returnReason && (
                    <p className="rounded-[10px] bg-brand-red/20 px-3 py-2">
                      <span className="font-semibold">{t("returnReason")}</span> {returnReason}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[#3d3f3a]">{t("noOpenVersion")}</p>
              )}
              {!archived && (
                <VersionActions
                  recipeId={recipe.id}
                  open={
                    open
                      ? { id: open.id, status: open.status, versionNo: open.version_no, submittedByMe: open.submitted_by === viewer.id }
                      : null
                  }
                  hasApproved={Boolean(approved)}
                  canReview={viewer.role === "ADMIN"}
                />
              )}
              {!archived && !neverSubmitted && !pendingArchive && (
                <ArchiveRecipeButton recipeId={recipe.id} mode={archiveMode} />
              )}
              <Link href={`/recipes/${recipe.id}/history`} className="text-sm underline">
                {t("changeLog.open")}
              </Link>
            </section>
          )}

          {pendingArchive && (
            <section className="flex flex-col gap-3 rounded-[20px] border-[1.5px] border-brand-orange bg-white p-5">
              <p className="text-sm font-semibold">{t("archive.pendingTitle")}</p>
              {pendingArchive.reason && (
                <p className="text-sm">
                  {t("archive.reason")}: {pendingArchive.reason}
                </p>
              )}
              {viewer.role === "ADMIN" ? (
                <ChangeReview kind="change" id={pendingArchive.id} />
              ) : (
                <p className="text-[13px] text-[#3d3f3a]">{t("archive.waiting")}</p>
              )}
            </section>
          )}
          {returnedArchive && (
            <section role="status" className="rounded-[20px] border-[1.5px] border-brand-red bg-white p-5">
              <p className="text-sm font-semibold">{t("archive.returnedTitle")}</p>
              <p className="mt-1 text-sm">{returnedArchive.review_reason}</p>
            </section>
          )}

          {!canManage && viewer.role !== "BARISTA" && approved && (
            <section className={card}>
              <p className="text-sm">{t("catalogueNote")}</p>
              <Link href={`/recipes/${recipe.id}/copy`} className={primaryButton}>
                {t("copy")}
              </Link>
            </section>
          )}

          {canManage && approved && <CostSummary cost={cost} title={t("costTitle")} />}

          {canManage && approved && !recipe.is_prep && (
            <section className={card}>
              <h2 className="text-base font-semibold">{t("usedOnMenus")}</h2>
              {(menus?.data ?? []).length === 0 ? (
                <p className="text-sm text-[#3d3f3a]">{t("noMenus")}</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {(menus?.data ?? []).map((m) => (
                    <li key={m.menu_id}>
                      {m.menus.name} · {t(`menuStatus.${m.menus.status}`)}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {canManage && (
            <section className={card}>
              <h2 className="text-base font-semibold">{t("history")}</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {(versions ?? []).map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">V{v.version_no}</span>
                    <StatusBadge status={v.status} />
                    <span className="text-[#3d3f3a]">{formatDateTime(v.approved_at ?? v.submitted_at ?? v.updated_at, locale)}</span>
                  </li>
                ))}
              </ul>
              {(events?.data ?? []).length > 0 && (
                <ul className="flex flex-col gap-1 border-t border-black/10 pt-3 text-sm">
                  {(events?.data ?? []).map((e) => (
                    <li key={e.id}>
                      {formatDateTime(e.created_at, locale)} · V{versionNo(e.entity_id)} · {t(`events.${e.action}`)}
                      {e.reason && ` · ${e.reason}`}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
