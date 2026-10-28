import { getFormatter, getTranslations } from "next-intl/server";
import {
  diffRows,
  formatValue,
  MATERIAL_FIELDS,
  PACK_FIELDS,
  PACKAGING_FIELDS,
  PRICE_FIELDS,
  type FieldChange,
} from "@/lib/materials/changes";
import { getViewer } from "@/lib/materials/viewer";
import { ChangeTable } from "./ItemSections";
import { cardClass } from "./ui";

type Entity = "MATERIAL" | "PACKAGING_ITEM";
type Row = Record<string, unknown>;
type Entry = {
  at: string;
  actor: string | null;
  title: string;
  changes: (FieldChange & { label: string })[];
  reason: string | null;
};

const SUBJECT: Record<string, string> = {
  materials: "item",
  packaging_items: "item",
  material_packs: "pack",
  material_price_versions: "price",
  packaging_prices: "price",
  MATERIAL: "item",
  PACKAGING_ITEM: "item",
  MATERIAL_PACK: "pack",
  MATERIAL_PRICE: "price",
  PACKAGING_PRICE: "price",
};

/**
 * Who changed what and when, newest first: field edits from the audit trail,
 * submit/approve/return from approval events, and edit or delete requests.
 */
export async function ChangeLog({ entity, id }: { entity: Entity; id: string }) {
  const t = await getTranslations("RawMaterials");
  const format = await getFormatter();
  const { supabase } = await getViewer();
  const [{ data }, { data: types }] = await Promise.all([
    supabase.rpc("item_change_log", { p_entity_type: entity, p_entity_id: id }),
    supabase.from("material_types").select("id, name"),
  ]);
  const typeName = new Map((types ?? []).map((type) => [type.id, type.name]));
  const formatter = {
    yes: t("detail.yes"),
    no: t("detail.no"),
    changed: t("history.photoChanged"),
    typeName: (typeId: string) => typeName.get(typeId),
    status: (status: string) => t(`status.${status}`),
  };
  const labelled = (changes: FieldChange[]) =>
    changes.map((change) => ({ ...change, label: t(`fields.${change.field}`) }));

  const rows = data ?? [];
  const reviewed = new Set(rows.filter((r) => r.source === "REVIEW").map((r) => r.record_id));
  const entries: Entry[] = [];

  for (const row of rows) {
    const before = row.old_values as Row | null;
    const after = row.new_values as Row | null;
    const base = { at: row.happened_at, actor: row.actor_name, reason: row.reason };

    if (row.source === "AUDIT") {
      const subject = SUBJECT[row.table_name ?? ""];
      const fields =
        row.table_name === "materials"
          ? MATERIAL_FIELDS
          : row.table_name === "packaging_items"
            ? PACKAGING_FIELDS
            : row.table_name === "material_packs"
              ? PACK_FIELDS
              : PRICE_FIELDS;
      if (row.action === "INSERT") {
        const summary =
          subject === "pack"
            ? `${formatValue("pack_quantity", after?.pack_quantity, formatter)} ${after?.unit ?? ""}`
            : subject === "price"
              ? formatValue("price", after?.price ?? after?.price_per_piece, formatter)
              : null;
        entries.push({
          ...base,
          title: summary ? `${t(`history.created.${subject}`)}: ${summary}` : t(`history.created.${subject}`),
          changes: [],
        });
      } else if (row.action === "UPDATE") {
        const changes = labelled(diffRows(fields, before, after, formatter));
        if (changes.length) entries.push({ ...base, title: t(`history.edited.${subject}`), changes });
      }
    } else if (row.source === "APPROVAL") {
      const subject = SUBJECT[row.table_name ?? ""] ?? "item";
      entries.push({
        ...base,
        title:
          subject === "item"
            ? t(`history.approval.${row.action}`)
            : `${t(`history.subject.${subject}`)} · ${t(`history.approval.${row.action}`)}`,
        changes: [],
      });
    } else if (row.source === "REQUEST") {
      const [action, status] = row.action.split(":");
      const direct = status === "APPROVED" && !reviewed.has(row.record_id);
      // A direct edit already shows as field changes from the audit trail.
      if (direct && action === "EDIT") continue;
      entries.push({
        ...base,
        title: direct ? t(`history.direct.${action}`) : t(`history.requested.${action}`),
        changes:
          !direct && action === "EDIT"
            ? labelled(diffRows(entity === "MATERIAL" ? MATERIAL_FIELDS : PACKAGING_FIELDS, before, after, formatter))
            : [],
      });
    } else if (row.source === "REVIEW") {
      const [action, status] = row.action.split(":");
      entries.push({ ...base, title: t(`history.reviewed.${status}`, { action: t(`history.requestKind.${action}`) }), changes: [] });
    }
  }

  if (entries.length === 0) {
    return <p className="rounded-[20px] bg-white p-6 text-sm text-[#3d3f3a]">{t("history.empty")}</p>;
  }

  return (
    <ol className="flex flex-col gap-3">
      {entries.map((entry, i) => (
        <li key={i} className={cardClass}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">{entry.title}</span>
            <span className="text-[13px] text-[#3d3f3a]">
              {entry.actor ?? t("history.system")} ·{" "}
              {format.dateTime(new Date(entry.at), {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Kuala_Lumpur",
              })}
            </span>
          </div>
          {entry.changes.length > 0 && <ChangeTable changes={entry.changes} />}
          {entry.reason && (
            <p className="text-sm">
              {t("requests.reason")}: {entry.reason}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
