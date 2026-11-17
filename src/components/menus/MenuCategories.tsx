"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
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
import type { Outlet } from "@/lib/auth/currentUser";
import { childrenOf, type MenuCategory } from "@/lib/menus/categories";
import { createClient } from "@/lib/supabase/client";

type Editing = { kind: "rename" | "add"; id: string } | null;

export function MenuCategories({
  outlets,
  categories,
  initialOutletId,
}: {
  outlets: Outlet[];
  categories: MenuCategory[];
  initialOutletId: string;
}) {
  const t = useTranslations("MenuCategories");
  const router = useRouter();
  const [outletId, setOutletId] = useState(initialOutletId);
  const [mainName, setMainName] = useState("");
  const [editing, setEditing] = useState<Editing>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outletCategories = categories.filter((c) => c.outletId === outletId);

  function errorMessage(err: { code?: string; message?: string }): string {
    if (err.message === "CATEGORY_HAS_CHILDREN") return t("hasChildren");
    if (err.message === "CATEGORY_IN_USE") return t("inUse");
    if (err.code === "23505") return t("duplicate");
    return t("failed");
  }

  async function run(action: () => Promise<{ code?: string; message?: string } | null>) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const err = await action();
    setBusy(false);
    if (err) {
      setError(errorMessage(err));
      return false;
    }
    router.refresh();
    return true;
  }

  async function insert(parentId: string | null, name: string) {
    const siblings = childrenOf(outletCategories, parentId);
    const sortOrder = siblings.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;
    const { error: insertError } = await createClient()
      .from("menu_categories")
      .insert({ outlet_id: outletId, parent_id: parentId, name: name.trim(), sort_order: sortOrder });
    return insertError;
  }

  async function handleAddMain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mainName.trim()) return;
    if (await run(() => insert(null, mainName))) setMainName("");
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !editName.trim()) return;
    const target = editing;
    const ok = await run(async () => {
      if (target.kind === "add") return insert(target.id, editName);
      const { error: updateError } = await createClient()
        .from("menu_categories")
        .update({ name: editName.trim() })
        .eq("id", target.id);
      return updateError;
    });
    if (ok) setEditing(null);
  }

  // Swaps a category with its neighbour; siblings are renumbered 1, 2, 3, …
  function move(category: MenuCategory, delta: number) {
    const siblings = childrenOf(outletCategories, category.parentId);
    const index = siblings.findIndex((c) => c.id === category.id);
    const next = [...siblings];
    next.splice(index, 1);
    next.splice(index + delta, 0, category);
    return run(async () => {
      const supabase = createClient();
      for (const [i, sibling] of next.entries()) {
        if (sibling.sortOrder === i + 1) continue;
        const { error: updateError } = await supabase
          .from("menu_categories")
          .update({ sort_order: i + 1 })
          .eq("id", sibling.id);
        if (updateError) return updateError;
      }
      return null;
    });
  }

  function remove(category: MenuCategory) {
    if (!window.confirm(t("deleteConfirm", { name: category.name }))) return;
    return run(async () => {
      // RLS hides rows it may not delete, so check that one row went.
      const { data, error: deleteError } = await createClient()
        .from("menu_categories")
        .delete()
        .eq("id", category.id)
        .select("id");
      if (deleteError) return deleteError;
      return data && data.length > 0 ? null : { message: "NOT_DELETED" };
    });
  }

  function startEdit(kind: "rename" | "add", category: MenuCategory) {
    setEditing({ kind, id: category.id });
    setEditName(kind === "rename" ? category.name : "");
    setError(null);
  }

  function editForm(label: string) {
    return (
      <form onSubmit={handleEditSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          autoFocus
          required
          maxLength={100}
          aria-label={label}
          placeholder={label}
          value={editName}
          onChange={(event) => setEditName(event.target.value)}
          className={`${inputClass} w-full sm:flex-1`}
        />
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className={`${primaryButton} flex-1 sm:flex-none`}>
            {t("save")}
          </button>
          <button type="button" onClick={() => setEditing(null)} className={`${secondaryButton} flex-1 sm:flex-none`}>
            {t("cancel")}
          </button>
        </div>
      </form>
    );
  }

  function renderLevel(parentId: string | null, depth: number) {
    const siblings = childrenOf(outletCategories, parentId);
    if (siblings.length === 0) return null;
    return (
      <ul className="flex flex-col gap-2">
        {siblings.map((category, index) => {
          const renaming = editing?.kind === "rename" && editing.id === category.id;
          const adding = editing?.kind === "add" && editing.id === category.id;
          return (
            <li key={category.id} className="flex flex-col gap-2">
              <div className="flex flex-col gap-2 rounded-[14px] border-[1.5px] border-black/15 p-3 md:flex-row md:items-center">
                {renaming ? (
                  <div className="flex-1">{editForm(t("rename"))}</div>
                ) : (
                  <span className="min-w-0 flex-1 font-semibold break-words">
                    {category.name}
                    {depth === 0 && <span className={`${mutedText} ml-2 font-normal`}>{t("main")}</span>}
                  </span>
                )}
                {!renaming && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy || index === 0}
                      onClick={() => move(category, -1)}
                      aria-label={t("moveUp", { name: category.name })}
                      className={smallButton}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={busy || index === siblings.length - 1}
                      onClick={() => move(category, 1)}
                      aria-label={t("moveDown", { name: category.name })}
                      className={smallButton}
                    >
                      ↓
                    </button>
                    <button type="button" disabled={busy} onClick={() => startEdit("rename", category)} className={smallButton}>
                      {t("rename")}
                    </button>
                    <button type="button" disabled={busy} onClick={() => startEdit("add", category)} className={smallButton}>
                      {t("addSub")}
                    </button>
                    <button type="button" disabled={busy} onClick={() => remove(category)} className={smallButton}>
                      {t("delete")}
                    </button>
                  </div>
                )}
              </div>
              {(adding || childrenOf(outletCategories, category.id).length > 0) && (
                <div className="flex flex-col gap-2 border-l-2 border-black/10 pl-3 sm:pl-5">
                  {adding && editForm(t("subName", { parent: category.name }))}
                  {renderLevel(category.id, depth + 1)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className={`${cardClass} flex flex-col gap-4`}>
        {outlets.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="category-outlet" className={labelClass}>
              {t("outlet")}
            </label>
            <select
              id="category-outlet"
              value={outletId}
              onChange={(event) => {
                setOutletId(event.target.value);
                setEditing(null);
                setError(null);
              }}
              className={inputClass}
            >
              {outlets.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <form onSubmit={handleAddMain} className="flex flex-col gap-1.5">
          <label htmlFor="new-main-category" className={labelClass}>
            {t("addMain")}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="new-main-category"
              required
              maxLength={100}
              placeholder={t("mainPlaceholder")}
              value={mainName}
              onChange={(event) => setMainName(event.target.value)}
              className={`${inputClass} w-full sm:flex-1`}
            />
            <button type="submit" disabled={busy || !outletId} className={`${primaryButton} shrink-0`}>
              {t("add")}
            </button>
          </div>
        </form>
        {error && (
          <p role="alert" className={errorText}>
            {error}
          </p>
        )}
      </section>

      <section className={`${cardClass} flex flex-col gap-4`} aria-labelledby="category-tree-heading">
        <h2 id="category-tree-heading" className="text-base font-semibold">
          {t("treeTitle")}
        </h2>
        {outletCategories.length === 0 ? <p className="text-sm">{t("empty")}</p> : renderLevel(null, 0)}
        <p className={mutedText}>{t("deleteRule")}</p>
      </section>
    </div>
  );
}
