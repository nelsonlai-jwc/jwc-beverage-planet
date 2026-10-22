"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { MenuStatus } from "@/components/menus/MenuStatus";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  cardClass,
  errorText,
  inputClass,
  labelClass,
  mutedText,
  primaryButton,
  secondaryButton,
  smallButton,
} from "@/components/ui/styles";
import { Link, useRouter } from "@/i18n/navigation";
import type { MenuRecipe } from "@/lib/menus/recipes";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type Item = { recipeId: string; price: number | null };
type Row = { recipeId: string; price: string };
type Problem = { recipe_id: string; code: string };

const problemCodes = [
  "PRICE_MISSING",
  "RECIPE_NOT_APPROVED",
  "NOT_OFFICIAL_RELEASE",
  "DEPENDENCY_INVALID",
  "PRICE_CONFLICT",
] as const;

export function MenuEditor({
  menu,
  revisionId,
  liveItems,
  draftItems,
  recipes,
  allRecipeNames,
}: {
  menu: {
    id: string;
    name: string;
    status: Database["public"]["Enums"]["menu_status"];
    outletName: string;
    publishedAt: string | null;
  };
  revisionId: string | null;
  liveItems: Item[];
  draftItems: Item[];
  recipes: MenuRecipe[];
  allRecipeNames: Record<string, string>;
}) {
  const t = useTranslations("Menus");
  const format = useFormatter();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    draftItems.map((item) => ({ recipeId: item.recipeId, price: item.price?.toFixed(2) ?? "" })),
  );
  const [dirty, setDirty] = useState(false);
  const [addId, setAddId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);

  const archived = menu.status === "ARCHIVED";
  const hasPending = revisionId !== null || dirty;
  const available = recipes.filter((r) => !rows.some((row) => row.recipeId === r.id));

  function update(next: Row[]) {
    setRows(next);
    setDirty(true);
    setNotice(null);
  }

  function move(index: number, delta: number) {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + delta, 0, row);
    update(next);
  }

  // Writes the rows as the menu's pending revision. Returns false on failure.
  async function saveDraft(): Promise<boolean> {
    const supabase = createClient();
    let id = revisionId;
    if (!id) {
      const { data: existing } = await supabase
        .from("menu_revisions")
        .select("id")
        .eq("menu_id", menu.id)
        .maybeSingle();
      id = existing?.id ?? null;
    }
    if (!id) {
      const { data, error: insertError } = await supabase
        .from("menu_revisions")
        .insert({ menu_id: menu.id })
        .select("id")
        .single();
      if (insertError || !data) return false;
      id = data.id;
    }
    const { error: deleteError } = await supabase
      .from("menu_revision_items")
      .delete()
      .eq("menu_revision_id", id);
    if (deleteError) return false;
    if (rows.length > 0) {
      const { error: insertError } = await supabase.from("menu_revision_items").insert(
        rows.map((row, index) => ({
          menu_revision_id: id,
          recipe_id: row.recipeId,
          price: row.price === "" ? null : Number(row.price),
          sort_order: index + 1,
        })),
      );
      if (insertError) return false;
    }
    return true;
  }

  async function run(action: () => Promise<boolean>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const ok = await action();
    setBusy(false);
    if (ok) {
      setDirty(false);
      router.refresh();
    }
  }

  function handleSave() {
    return run(async () => {
      setProblems([]);
      const ok = await saveDraft();
      if (!ok) setError(t("saveFailed"));
      else setNotice(t("draftSaved"));
      return ok;
    });
  }

  function handlePublish() {
    return run(async () => {
      setProblems([]);
      if (hasPending && !(await saveDraft())) {
        setError(t("saveFailed"));
        return false;
      }
      const { error: rpcError } = await createClient().rpc("publish_menu", { p_menu_id: menu.id });
      if (rpcError) {
        // Saved as pending; the live menu is unchanged.
        setDirty(false);
        if (rpcError.message === "MENU_PUBLISH_BLOCKED") {
          try {
            setProblems(JSON.parse(rpcError.details ?? "[]"));
          } catch {
            setProblems([]);
          }
          setError(t("publishBlocked"));
        } else if (rpcError.message === "MENU_EMPTY") {
          setError(t("menuEmpty"));
        } else {
          setError(t("publishFailed"));
        }
        router.refresh();
        return false;
      }
      setNotice(t("published"));
      return true;
    });
  }

  function handleDiscard() {
    if (!window.confirm(t("discardConfirm"))) return;
    return run(async () => {
      setProblems([]);
      if (revisionId) {
        const { error: deleteError } = await createClient()
          .from("menu_revisions")
          .delete()
          .eq("id", revisionId);
        if (deleteError) {
          setError(t("saveFailed"));
          return false;
        }
      }
      setRows(liveItems.map((item) => ({ recipeId: item.recipeId, price: item.price?.toFixed(2) ?? "" })));
      return true;
    });
  }

  function handleUnpublish() {
    if (!window.confirm(t("unpublishConfirm"))) return;
    return run(async () => {
      const { error: rpcError } = await createClient().rpc("unpublish_menu", { p_menu_id: menu.id });
      if (rpcError) setError(t("actionFailed"));
      return !rpcError;
    });
  }

  async function handleArchive() {
    if (busy || !window.confirm(t("archiveConfirm"))) return;
    setBusy(true);
    const { error: rpcError } = await createClient().rpc("archive_menu", { p_menu_id: menu.id });
    if (rpcError) {
      setError(t("actionFailed"));
      setBusy(false);
      return;
    }
    router.push("/menus");
    router.refresh();
  }

  async function handleDelete() {
    if (busy || !window.confirm(t("deleteConfirm"))) return;
    setBusy(true);
    const { error: deleteError } = await createClient().from("menus").delete().eq("id", menu.id);
    if (deleteError) {
      setError(t("actionFailed"));
      setBusy(false);
      return;
    }
    router.push("/menus");
    router.refresh();
  }

  const problemsFor = (recipeId: string) =>
    problems.filter((p) => p.recipe_id === recipeId).map((p) => p.code);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/menus" className="self-start text-sm underline">
          {t("backToMenus")}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-[32px] font-normal">{menu.name}</h1>
          <MenuStatus status={menu.status} />
          {hasPending && !archived && <StatusBadge tone="purple">{t("pendingChanges")}</StatusBadge>}
        </div>
        <p className={mutedText}>
          {menu.outletName}
          {menu.publishedAt &&
            ` · ${t("lastPublished", {
              date: format.dateTime(new Date(menu.publishedAt), {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Kuala_Lumpur",
              }),
            })}`}
        </p>
      </div>

      {menu.status === "PUBLISHED" && hasPending && (
        <p className="rounded-[14px] border-[1.5px] border-brand-purple bg-white px-4 py-3 text-sm">
          {t("pendingNote")}
        </p>
      )}

      <section className={`${cardClass} flex flex-col gap-4`} aria-labelledby="menu-items-heading">
        <h2 id="menu-items-heading" className="text-base font-semibold">
          {t("items")}
        </h2>
        {rows.length === 0 && <p className="text-sm">{t("noItems")}</p>}
        <ol className="flex flex-col gap-3">
          {rows.map((row, index) => {
            const codes = problemsFor(row.recipeId);
            const name = allRecipeNames[row.recipeId] ?? "—";
            return (
              <li
                key={row.recipeId}
                className={`flex flex-col gap-3 rounded-[14px] border-[1.5px] p-3 md:flex-row md:items-center ${
                  codes.length ? "border-[#c4161c]" : "border-black/15"
                }`}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">
                    {index + 1}. {name}
                  </span>
                  {codes.map((code) => (
                    <span key={code} className="text-[13px] font-semibold text-[#c4161c]">
                      {problemCodes.includes(code as (typeof problemCodes)[number])
                        ? t(`problems.${code as (typeof problemCodes)[number]}`)
                        : code}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-sm md:flex-none">
                    <span className="font-semibold">MYR</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      disabled={archived}
                      aria-label={t("priceFor", { name })}
                      value={row.price}
                      onChange={(event) =>
                        update(rows.map((r, i) => (i === index ? { ...r, price: event.target.value } : r)))
                      }
                      className={`${inputClass} w-full md:w-28`}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={archived || index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={t("moveUp", { name })}
                    className={smallButton}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={archived || index === rows.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={t("moveDown", { name })}
                    className={smallButton}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    disabled={archived}
                    onClick={() => update(rows.filter((_, i) => i !== index))}
                    className={`${smallButton} shrink-0 whitespace-nowrap`}
                  >
                    {t("remove")}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>

        {!archived && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="add-recipe" className={labelClass}>
              {t("addRecipe")}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                id="add-recipe"
                value={addId}
                onChange={(event) => setAddId(event.target.value)}
                className={`${inputClass} w-full sm:flex-1`}
              >
                <option value="">{available.length ? t("chooseRecipe") : t("noRecipesAvailable")}</option>
                {available.map((recipe) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipe.productName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!addId}
                onClick={() => {
                  update([...rows, { recipeId: addId, price: "" }]);
                  setAddId("");
                }}
                className={`${secondaryButton} shrink-0`}
              >
                {t("add")}
              </button>
            </div>
            <p className={mutedText}>{t("addRecipeHint")}</p>
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className={errorText}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm font-semibold">
          {notice}
        </p>
      )}

      {!archived && (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy || (!hasPending && menu.status === "PUBLISHED")}
            onClick={handlePublish}
            className={primaryButton}
          >
            {menu.status === "PUBLISHED" ? t("publishChanges") : t("publish")}
          </button>
          <button type="button" disabled={busy || !dirty} onClick={handleSave} className={secondaryButton}>
            {t("saveDraft")}
          </button>
          {menu.publishedAt && hasPending && (
            <button type="button" disabled={busy} onClick={handleDiscard} className={secondaryButton}>
              {t("discardChanges")}
            </button>
          )}
          {menu.status === "PUBLISHED" && (
            <button type="button" disabled={busy} onClick={handleUnpublish} className={secondaryButton}>
              {t("unpublish")}
            </button>
          )}
          {menu.publishedAt ? (
            <button type="button" disabled={busy} onClick={handleArchive} className={secondaryButton}>
              {t("archive")}
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={handleDelete} className={secondaryButton}>
              {t("delete")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
