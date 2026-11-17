"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { MenuStatus } from "@/components/menus/MenuStatus";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { DrinkRow } from "@/components/menus/DrinkRow";
import type { DrinkCost, EstimateState } from "@/components/menus/PriceHint";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  cardClass,
  errorText,
  inputClass,
  labelClass,
  mutedText,
  primaryButton,
  secondaryButton,
} from "@/components/ui/styles";
import { Link, useRouter } from "@/i18n/navigation";
import { categoryLabel, groupByCategory, type FlatCategory } from "@/lib/menus/categories";
import type { MenuRecipe } from "@/lib/menus/recipes";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import { recipeNameText } from "@/components/recipes/RecipeName";
import type { BeverageTemp } from "@/lib/recipes/types";

type Item = { recipeId: string; price: number | null; categoryId: string | null };
// categoryId "" means Uncategorized.
type Row = { recipeId: string; price: string; categoryId: string };
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
  allRecipeTemps,
  categories,
  costs,
}: {
  menu: {
    id: string;
    name: string;
    status: Database["public"]["Enums"]["menu_status"];
    outletId: string;
    outletName: string;
    publishedAt: string | null;
  };
  revisionId: string | null;
  liveItems: Item[];
  draftItems: Item[];
  recipes: MenuRecipe[];
  allRecipeNames: Record<string, string>;
  // Drink temperatures, shown after the names.
  allRecipeTemps: Record<string, BeverageTemp | null>;
  // The outlet's categories in tree order.
  categories: FlatCategory[];
  // Current cost of each drink, keyed by recipe id; missing when not available.
  costs: Record<string, DrinkCost>;
}) {
  const t = useTranslations("Menus");
  const format = useFormatter();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    draftItems.map(toRow),
  );
  const [dirty, setDirty] = useState(false);
  const [addId, setAddId] = useState("");
  const [addCategoryId, setAddCategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  // AI price estimate per drink, keyed by recipe id.
  const [estimates, setEstimates] = useState<Record<string, EstimateState>>({});
  // Drag starts after a small move, so taps on the handle don't reorder.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const archived = menu.status === "ARCHIVED";
  const hasPending = revisionId !== null || dirty;
  const available = recipes.filter((r) => !rows.some((row) => row.recipeId === r.id));
  // Drinks are shown and saved grouped by category (tree order, Uncategorized last).
  const groups = groupByCategory(
    rows.map((row) => ({ ...row, categoryId: row.categoryId || null })),
    categories,
  );
  const ordered = groups.flatMap((group) => group.items);
  const showGroups = categories.length > 0;

  function update(next: Row[]) {
    setRows(next);
    setDirty(true);
    setNotice(null);
  }

  // Moves a dragged drink to where it was dropped (always within its own category).
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = rows.findIndex((r) => r.recipeId === active.id);
    const to = rows.findIndex((r) => r.recipeId === over.id);
    if (from < 0 || to < 0) return;
    update(arrayMove(rows, from, to));
  }

  function setRow(recipeId: string, change: Partial<Row>) {
    update(rows.map((r) => (r.recipeId === recipeId ? { ...r, ...change } : r)));
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
    if (ordered.length > 0) {
      const { error: insertError } = await supabase.from("menu_revision_items").insert(
        ordered.map((row, index) => ({
          menu_revision_id: id,
          recipe_id: row.recipeId,
          price: row.price === "" ? null : Number(row.price),
          sort_order: index + 1,
          category_id: row.categoryId,
        })),
      );
      if (insertError) return false;
    }
    return true;
  }

  // The database rejects prices of zero or less; mark those rows instead of failing the save.
  function pricesValid(): boolean {
    const invalid = rows.filter((row) => row.price !== "" && !(Number(row.price) > 0));
    if (invalid.length === 0) return true;
    setProblems(invalid.map((row) => ({ recipe_id: row.recipeId, code: "PRICE_MISSING" })));
    setError(t("invalidPrice"));
    return false;
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
      if (!pricesValid()) return false;
      const ok = await saveDraft();
      if (!ok) setError(t("saveFailed"));
      else setNotice(t("draftSaved"));
      return ok;
    });
  }

  function handlePublish() {
    return run(async () => {
      setProblems([]);
      if (!pricesValid()) return false;
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
      setRows(liveItems.map(toRow));
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
          <h1 className="text-2xl font-semibold leading-tight tracking-[-0.02em] md:text-[28px]">{menu.name}</h1>
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
        {groups.map((group) => (
          <div key={group.category?.id ?? "none"} className="flex flex-col gap-3">
            {showGroups && (
              <h3 className="text-sm font-semibold">
                {group.category ? categoryLabel(group.category) : t("uncategorized")}
              </h3>
            )}
            <DndContext
              // Fixed id: generated ids differ between server and browser.
              id={`menu-drinks-${group.category?.id ?? "none"}`}
              sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={group.items.map((row) => row.recipeId)} strategy={verticalListSortingStrategy}>
                <ol className="flex flex-col gap-2">
                  {group.items.map((row) => {
                    const name = allRecipeNames[row.recipeId] ?? "—";
                    return (
                      <DrinkRow
                        key={row.recipeId}
                        recipeId={row.recipeId}
                        name={name}
                        temperature={allRecipeTemps[row.recipeId]}
                        position={ordered.indexOf(row) + 1}
                        price={row.price}
                        categoryId={row.categoryId ?? ""}
                        categories={categories}
                        showCategory={showGroups}
                        problems={problemsFor(row.recipeId).map((code) =>
                          problemCodes.includes(code as (typeof problemCodes)[number])
                            ? t(`problems.${code as (typeof problemCodes)[number]}`)
                            : code,
                        )}
                        archived={archived}
                        cost={costs[row.recipeId]}
                        estimate={estimates[row.recipeId]}
                        onPrice={(price) => setRow(row.recipeId, { price })}
                        onCategory={(categoryId) => setRow(row.recipeId, { categoryId })}
                        onEstimate={(state) => setEstimates((current) => ({ ...current, [row.recipeId]: state }))}
                        onRemove={() => update(rows.filter((r) => r.recipeId !== row.recipeId))}
                      />
                    );
                  })}
                </ol>
              </SortableContext>
            </DndContext>
          </div>
        ))}

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
                    {recipeNameText(recipe.productName, recipe.temperature && t(`temps.${recipe.temperature}`))}
                  </option>
                ))}
              </select>
              {showGroups && (
                <select
                  aria-label={t("addCategory")}
                  value={addCategoryId}
                  onChange={(event) => setAddCategoryId(event.target.value)}
                  className={`${inputClass} w-full sm:w-56`}
                >
                  <option value="">{t("uncategorized")}</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {categoryLabel(category)}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                disabled={!addId}
                onClick={() => {
                  update([...rows, { recipeId: addId, price: "", categoryId: addCategoryId }]);
                  setAddId("");
                }}
                className={`${secondaryButton} shrink-0`}
              >
                {t("add")}
              </button>
            </div>
            <p className={mutedText}>{t("addRecipeHint")}</p>
            <p className={mutedText}>
              {categories.length === 0 && `${t("noCategories")} `}
              <Link href={`/menus/categories?outlet=${menu.outletId}`} className="underline">
                {t("manageCategories")}
              </Link>
            </p>
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

function toRow(item: Item): Row {
  return { recipeId: item.recipeId, price: item.price?.toFixed(2) ?? "", categoryId: item.categoryId ?? "" };
}
