import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { diffRows, MATERIAL_FIELDS, PACKAGING_FIELDS } from "@/lib/materials/changes";
import { getViewer } from "@/lib/materials/viewer";
import { ReviewActions } from "./ReviewActions";
import { cardClass } from "./ui";

type Entity = "MATERIAL" | "PACKAGING_ITEM";

/** Recipes that use the item: live ones first (they block archiving), then drafts. */
export async function UsageSection({ entity, id }: { entity: Entity; id: string }) {
  const t = await getTranslations("RawMaterials.usage");
  const { supabase } = await getViewer();
  const { data } = await supabase.rpc("item_usage", {
    p_material_id: entity === "MATERIAL" ? id : null,
    p_packaging_item_id: entity === "PACKAGING_ITEM" ? id : null,
  });
  const rows = data ?? [];

  return (
    <section className={cardClass} aria-labelledby="usage">
      <h2 id="usage" className="text-base font-semibold">
        {t("title")}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-[#3d3f3a]">{t("none")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.recipe_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="flex min-w-0 flex-col">
                <Link href={`/recipes/${row.recipe_id}`} className="font-semibold underline">
                  {row.product_name ?? t("untitled")}
                </Link>
                <span className="text-[13px] text-[#3d3f3a]">
                  {row.outlet_name}
                  {row.via_prep_name && ` · ${t("viaPrep", { name: row.via_prep_name })}`}
                </span>
              </div>
              <span
                className={`rounded-full border-[1.5px] px-2.5 py-0.5 text-xs font-semibold ${
                  row.usage === "LIVE" ? "border-brand-green bg-brand-green" : "border-black/40"
                }`}
              >
                {row.usage === "LIVE" ? t("live") : t("draft")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.some((row) => row.usage === "LIVE") && (
        <p className="text-[13px] text-[#3d3f3a]">{t("blocksArchive")}</p>
      )}
    </section>
  );
}

/** A waiting edit or delete request, or the Admin's answer to the latest one. */
export async function ChangeRequestNotice({
  entity,
  id,
  isAdmin,
}: {
  entity: Entity;
  id: string;
  isAdmin: boolean;
}) {
  const t = await getTranslations("RawMaterials");
  const { supabase, userId } = await getViewer();
  const { data } = await supabase
    .from("change_requests")
    .select("id, action, status, changes, old_values, reason, review_reason, requested_by, created_at")
    .eq("entity_type", entity)
    .eq("entity_id", id)
    .in("action", ["EDIT", "ARCHIVE"])
    .order("created_at", { ascending: false })
    .limit(1);
  const request = data?.[0];
  if (!request) return null;

  if (request.status === "RETURNED" && request.requested_by === userId) {
    return (
      <div role="status" className="rounded-[20px] border-[1.5px] border-brand-red bg-white p-5">
        <p className="text-sm font-semibold">
          {request.action === "EDIT" ? t("requests.editReturned") : t("requests.archiveReturned")}
        </p>
        <p className="mt-1 text-sm">{request.review_reason}</p>
      </div>
    );
  }
  if (request.status !== "PENDING") return null;

  const changes = await describeChanges(
    entity,
    request.old_values as Record<string, unknown> | null,
    request.changes as Record<string, unknown> | null,
  );

  return (
    <div className="flex flex-col gap-3 rounded-[20px] border-[1.5px] border-brand-orange bg-white p-5">
      <p className="text-sm font-semibold">
        {request.action === "EDIT" ? t("requests.editPending") : t("requests.archivePending")}
      </p>
      {changes.length > 0 && <ChangeTable changes={changes} />}
      {request.reason && (
        <p className="text-sm">
          {t("requests.reason")}: {request.reason}
        </p>
      )}
      {isAdmin ? (
        <ReviewActions kind="change" id={request.id} />
      ) : (
        <p className="text-[13px] text-[#3d3f3a]">{t("requests.waiting")}</p>
      )}
    </div>
  );
}

export async function describeChanges(
  entity: Entity,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) {
  const t = await getTranslations("RawMaterials");
  const { supabase } = await getViewer();
  const { data: types } = await supabase.from("material_types").select("id, name");
  const typeName = new Map((types ?? []).map((type) => [type.id, type.name]));
  const fields = entity === "MATERIAL" ? MATERIAL_FIELDS : PACKAGING_FIELDS;
  return diffRows(fields, before ?? {}, after, {
    yes: t("detail.yes"),
    no: t("detail.no"),
    changed: t("history.photoChanged"),
    typeName: (typeId) => typeName.get(typeId),
    status: (status) => t(`status.${status}`),
  }).map((change) => ({ ...change, label: t(`fields.${change.field}`) }));
}

export async function ChangeTable({
  changes,
}: {
  changes: { field: string; label: string; from: string; to: string }[];
}) {
  const t = await getTranslations("RawMaterials.history");
  return (
    <dl className="grid gap-2 text-sm">
      {changes.map((change) => (
        <div key={change.field} className="grid gap-x-3 sm:grid-cols-[140px_minmax(0,1fr)]">
          <dt className="text-[#3d3f3a]">{change.label}</dt>
          <dd className="break-words">
            {change.from && (
              <>
                <span className="text-[#3d3f3a] line-through" aria-label={t("before")}>
                  {change.from}
                </span>{" "}
                →{" "}
              </>
            )}
            <span className="font-semibold">{change.to}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
