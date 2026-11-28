"use client";

import { toast } from "@/components/ui/toast";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import {
  bulkCopyRecipes,
  bulkDeleteRecipes,
  bulkSetRecipeOutlets,
  type BulkResult,
} from "@/app/[locale]/(app)/recipes/actions";
import { useRouter } from "@/i18n/navigation";
import type { MineCard } from "@/lib/recipes/mine";
import type { Outlet } from "@/lib/recipes/types";
import { OutletChecklist } from "./OutletChecklist";
import { alertClass, inputClass, primaryButton, secondaryButton, smallButton, textareaClass } from "./ui";

type Panel = "outlets" | "copy" | "delete" | null;
type Skip = { id: string; name?: string; error: string; message?: string };

/**
 * Bar at the bottom of the "My outlets" list while recipes are selected: Change outlets
 * (Admin), Copy and Delete for all of them at once. Each recipe follows the rules of its
 * single action; the ones that can't be done are skipped and listed with the reason.
 */
export function BulkActions({
  selected,
  isAdmin,
  outlets,
  onCancel,
}: {
  selected: MineCard[];
  isAdmin: boolean;
  // Outlets the viewer manages: copy targets, and the outlet list for Admin.
  outlets: Outlet[];
  onCancel: () => void;
}) {
  const t = useTranslations("Recipes.bulk");
  const tr = useTranslations("Recipes");
  const router = useRouter();
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  const [panel, setPanel] = useState<Panel>(null);
  const [outletIds, setOutletIds] = useState<string[]>([]);
  const [allOutlets, setAllOutlets] = useState(false);
  const [target, setTarget] = useState(outlets.length === 1 ? outlets[0].id : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ done: number; requested: number; skipped: Skip[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const nameOf = new Map(selected.map((r) => [r.id, r.name]));
  const deletable = selected.filter((r) => r.canManage && !r.archivePending);
  const needsReason = deletable.some((r) => !r.neverSubmitted && r.archiveMode === "request");

  const reasonText = (s: Skip) => {
    if (t.has(`errors.${s.error}`)) return t(`errors.${s.error}`);
    if (tr.has(`actionErrors.${s.error}`)) return tr(`actionErrors.${s.error}`);
    return `${tr("actionErrors.UNKNOWN")} ${s.message ?? ""}`;
  };

  function run(action: () => Promise<BulkResult[]>, before: Skip[] = []) {
    setError(null);
    startTransition(async () => {
      const results = await action();
      const skipped = [...before, ...results.filter((r) => !r.ok).map((r) => ({ id: r.id, error: r.error ?? "UNKNOWN", message: r.message }))];
      const done = results.filter((r) => r.ok && r.outcome !== "REQUESTED").length;
      const requested = results.filter((r) => r.ok && r.outcome === "REQUESTED").length;
      setPanel(null);
      // Names are kept now: a deleted recipe leaves the list after the refresh.
      setReport({ done, requested, skipped: skipped.map((s) => ({ ...s, name: nameOf.get(s.id) })) });
      if (done + requested > 0) toast("saved");
      router.refresh();
    });
  }

  function saveOutlets() {
    if (!allOutlets && !outletIds.length) {
      setError(tr("errors.OUTLET_REQUIRED"));
      return;
    }
    run(() => bulkSetRecipeOutlets(selected.map((r) => r.id), outletIds, allOutlets));
  }

  function copy() {
    if (!target) {
      setError(tr("errors.OUTLET_REQUIRED"));
      return;
    }
    run(() =>
      bulkCopyRecipes(
        selected.map((r) => ({ recipeId: r.id, versionId: r.open?.id ?? null })),
        target,
        idempotencyKey,
      ),
    );
  }

  function remove() {
    if (needsReason && !reason.trim()) {
      setError(tr("actionErrors.REASON_REQUIRED"));
      return;
    }
    const skipped = selected
      .filter((r) => !deletable.includes(r))
      .map((r) => ({ id: r.id, error: r.archivePending ? "REQUEST_ALREADY_PENDING" : "NOT_ALLOWED" }));
    if (!deletable.length) {
      setReport({ done: 0, requested: 0, skipped });
      setPanel(null);
      return;
    }
    run(
      () => bulkDeleteRecipes(deletable.map((r) => ({ recipeId: r.id, neverSubmitted: r.neverSubmitted })), reason),
      skipped,
    );
  }

  const open = (next: Panel) => {
    setError(null);
    setReport(null);
    setPanel(next);
  };

  return (
    <div
      role="region"
      aria-label={t("barLabel")}
      className="fixed inset-x-0 bottom-[calc(3rem+env(safe-area-inset-bottom))] z-20 border-t border-black/15 bg-brand-base/95 px-4 py-3 backdrop-blur md:left-60 md:px-8"
    >
      <div className="mx-auto flex max-h-[60dvh] max-w-5xl flex-col gap-3 overflow-y-auto">
        {report && (
          <div role="status" className="flex flex-col gap-2 rounded-[12px] bg-white p-3 text-sm">
            <p className="font-semibold">
              {t("resultDone", { count: report.done })}
              {report.requested > 0 && ` · ${t("resultRequested", { count: report.requested })}`}
              {report.skipped.length > 0 && ` · ${t("resultSkipped", { count: report.skipped.length })}`}
            </p>
            {report.skipped.length > 0 && (
              <ul className="flex flex-col gap-1">
                {report.skipped.map((s) => (
                  <li key={s.id}>
                    <span className="font-semibold">{s.name ?? nameOf.get(s.id) ?? tr("untitled")}</span>: {reasonText(s)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {panel === "outlets" && (
          <div className="flex flex-col gap-3 rounded-[12px] bg-white p-3">
            <p className="text-sm font-semibold">{t("outletsTitle", { count: selected.length })}</p>
            <OutletChecklist
              outlets={outlets}
              allowAll
              outletIds={outletIds}
              allOutlets={allOutlets}
              onChange={(ids, all) => {
                setOutletIds(ids);
                setAllOutlets(all);
              }}
            />
            <p className="text-[13px] text-[#3d3f3a]">{t("outletsNote")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primaryButton} disabled={pending} onClick={saveOutlets}>
                {t("outletsSave")}
              </button>
              <button type="button" className={secondaryButton} onClick={() => setPanel(null)}>
                {t("back")}
              </button>
            </div>
          </div>
        )}

        {panel === "copy" && (
          <div className="flex flex-col gap-3 rounded-[12px] bg-white p-3">
            <p className="text-sm font-semibold">{t("copyTitle", { count: selected.length })}</p>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">{tr("targetOutlet")}</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass}>
                {outlets.length !== 1 && <option value="">{tr("chooseOutlet")}</option>}
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[13px] text-[#3d3f3a]">{t("copyNote")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primaryButton} disabled={pending} onClick={copy}>
                {t("copyConfirm", { count: selected.length })}
              </button>
              <button type="button" className={secondaryButton} onClick={() => setPanel(null)}>
                {t("back")}
              </button>
            </div>
          </div>
        )}

        {panel === "delete" && (
          <div className="flex flex-col gap-3 rounded-[12px] bg-white p-3">
            <p className="text-sm font-semibold">{t("deleteTitle", { count: deletable.length })}</p>
            <p className="text-[13px] text-[#3d3f3a]">{needsReason ? t("deleteNoteRequest") : t("deleteNote")}</p>
            {deletable.length < selected.length && (
              <p className="text-[13px] text-[#3d3f3a]">{t("deleteSkipNote", { count: selected.length - deletable.length })}</p>
            )}
            {deletable.some((r) => !r.neverSubmitted) && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">
                  {needsReason ? tr("archive.reason") : tr("archive.reasonOptional")}
                </span>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} className={textareaClass} />
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primaryButton} disabled={pending} onClick={remove}>
                {t("deleteConfirm", { count: deletable.length })}
              </button>
              <button type="button" className={secondaryButton} onClick={() => setPanel(null)}>
                {t("back")}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className={alertClass}>
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-auto text-sm font-semibold" aria-live="polite">
            {pending ? t("working") : t("selected", { count: selected.length })}
          </span>
          {isAdmin && (
            <button type="button" className={smallButton} disabled={!selected.length || pending} onClick={() => open("outlets")}>
              {t("changeOutlets")}
            </button>
          )}
          <button type="button" className={smallButton} disabled={!selected.length || pending} onClick={() => open("copy")}>
            {tr("copy")}
          </button>
          <button type="button" className={smallButton} disabled={!selected.length || pending} onClick={() => open("delete")}>
            {tr("archive.delete")}
          </button>
          <button type="button" className={smallButton} disabled={pending} onClick={onCancel}>
            {t("cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
