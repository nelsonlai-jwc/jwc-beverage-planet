"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  removeListValue,
  reorderValues,
  saveListValue,
  saveOptionLabel,
  setListValueActive,
  type ListGroup,
  type SettingResult,
} from "@/app/[locale]/(app)/settings/actions";
import { useRouter } from "@/i18n/navigation";
import type { OptionGroup } from "@/lib/settings/options";
import { alertClass, inputClass, primaryButton, secondaryButton, smallButton } from "@/components/recipes/ui";

function move<T>(list: T[], index: number, delta: number) {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return list;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function useSettingAction() {
  const t = useTranslations("Settings.edit");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function run(action: () => Promise<SettingResult>, onDone?: (result: SettingResult) => void) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t("errors.UNKNOWN"));
        return;
      }
      onDone?.(result);
      router.refresh();
    });
  }
  return { error, notice, setNotice, pending, run };
}

export function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" width="16" height="16" className={className}>
      <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Row header: tap the name to open or close that item's fields. */
function ItemToggle({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1 text-left"
    >
      <span className="flex min-w-0 flex-wrap items-center gap-2">{children}</span>
      <Chevron className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

export type ListItem = { id: string; name: string; code?: string; active: boolean };

/** Material types or outlets: add, rename, reorder, delete (or disable when in use). */
export function ListValuesEditor({ group, items: initial }: { group: ListGroup; items: ListItem[] }) {
  const t = useTranslations("Settings.edit");
  const { error, notice, setNotice, pending, run } = useSettingAction();
  const [items, setItems] = useState(initial);
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const isOutlet = group === "OUTLET";

  // Server data changed (after refresh): start from it again.
  const [source, setSource] = useState(initial);
  if (source !== initial) {
    setSource(initial);
    setItems(initial);
    setNames({});
  }

  function reorder(index: number, delta: number) {
    const next = move(items, index, delta);
    setItems(next);
    run(() => reorderValues(group, next.map((item) => item.id)));
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => {
          const name = names[item.id] ?? item.name;
          const changed = name.trim() !== item.name;
          const open = openId === item.id;
          return (
            <li key={item.id} className="flex flex-col gap-2 rounded-[12px] border border-black/15 p-2.5">
              <div className="flex items-center gap-2">
                <span className="flex gap-1">
                  <button type="button" className={smallButton} aria-label={t("moveUp")} disabled={pending || index === 0} onClick={() => reorder(index, -1)}>
                    ↑
                  </button>
                  <button type="button" className={smallButton} aria-label={t("moveDown")} disabled={pending || index === items.length - 1} onClick={() => reorder(index, 1)}>
                    ↓
                  </button>
                </span>
                <ItemToggle open={open} onToggle={() => setOpenId(open ? null : item.id)}>
                  <span className={`font-semibold ${item.active ? "" : "text-[#3d3f3a]"}`}>{item.name}</span>
                  {item.code && <span className="text-[13px] text-[#3d3f3a]">{item.code}</span>}
                  {!item.active && (
                    <span className="rounded-full bg-[#eceee8] px-2.5 py-0.5 text-xs font-semibold">{t("disabled")}</span>
                  )}
                </ItemToggle>
              </div>
              {open && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={name}
                    aria-label={t("name")}
                    onChange={(e) => setNames({ ...names, [item.id]: e.target.value })}
                    className={`${inputClass} min-w-0 flex-1 basis-40 ${item.active ? "" : "text-[#3d3f3a]"}`}
                  />
                  {changed && (
                    <button
                      type="button"
                      className={primaryButton}
                      disabled={pending}
                      onClick={() => run(() => saveListValue(group, item.id, { name }), () => setNotice(t("saved")))}
                    >
                      {t("save")}
                    </button>
                  )}
                  {item.active ? (
                    <button
                      type="button"
                      className={secondaryButton}
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm(t("deleteConfirm", { name: item.name }))) return;
                        run(
                          () => removeListValue(group, item.id),
                          (result) =>
                            setNotice(result.ok && result.outcome === "DISABLED" ? t("disabledInUse", { name: item.name }) : t("deleted")),
                        );
                      }}
                    >
                      {t("delete")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={secondaryButton}
                      disabled={pending}
                      onClick={() => run(() => setListValueActive(group, item.id, true), () => setNotice(t("enabled")))}
                    >
                      {t("enable")}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <form
        className="flex flex-wrap items-center gap-2 border-t border-black/10 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => saveListValue(group, null, { name: newName, code: newCode }),
            () => {
              setNewName("");
              setNewCode("");
              setNotice(t("added"));
            },
          );
        }}
      >
        {isOutlet && (
          <input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value.toUpperCase())}
            placeholder={t("codePlaceholder")}
            aria-label={t("code")}
            className={`${inputClass} w-40`}
          />
        )}
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={isOutlet ? t("outletPlaceholder") : t("typePlaceholder")}
          aria-label={t("name")}
          className={`${inputClass} min-w-0 flex-1 basis-40`}
        />
        <button type="submit" className={secondaryButton} disabled={pending || !newName.trim() || (isOutlet && !newCode.trim())}>
          {t("add")}
        </button>
      </form>
      {isOutlet && <p className="text-[13px] text-[#3d3f3a]">{t("codeHint")}</p>}
      {notice && (
        <p role="status" className="text-sm font-semibold">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
    </div>
  );
}

export type OptionItem = { value: string; en: string; zh: string };

/** Style, temperature and strength: English and Chinese names, and the order. */
export function OptionLabelsEditor({ group, items: initial }: { group: OptionGroup; items: OptionItem[] }) {
  const t = useTranslations("Settings.edit");
  const { error, notice, setNotice, pending, run } = useSettingAction();
  const [items, setItems] = useState(initial);
  const [edits, setEdits] = useState<Record<string, { en: string; zh: string }>>({});
  const [openValue, setOpenValue] = useState<string | null>(null);
  const [source, setSource] = useState(initial);
  if (source !== initial) {
    setSource(initial);
    setItems(initial);
    setEdits({});
  }

  function reorder(index: number, delta: number) {
    const next = move(items, index, delta);
    setItems(next);
    run(() => reorderValues(group, next.map((item) => item.value)));
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {items.map((item, index) => {
          const edit = edits[item.value] ?? { en: item.en, zh: item.zh };
          const changed = edit.en.trim() !== item.en || edit.zh.trim() !== item.zh;
          const open = openValue === item.value;
          return (
            <li key={item.value} className="flex flex-col gap-2 rounded-[12px] border border-black/15 p-2.5">
              <div className="flex items-center gap-2">
                <span className="flex gap-1">
                  <button type="button" className={smallButton} aria-label={t("moveUp")} disabled={pending || index === 0} onClick={() => reorder(index, -1)}>
                    ↑
                  </button>
                  <button type="button" className={smallButton} aria-label={t("moveDown")} disabled={pending || index === items.length - 1} onClick={() => reorder(index, 1)}>
                    ↓
                  </button>
                </span>
                <ItemToggle open={open} onToggle={() => setOpenValue(open ? null : item.value)}>
                  <span className="font-semibold">
                    {item.en} / {item.zh}
                  </span>
                </ItemToggle>
              </div>
              {open && (
                <>
                  <span className="text-[13px] text-[#3d3f3a]">{t("storedValue", { value: item.value })}</span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[13px] font-semibold">English</span>
                      <input
                        value={edit.en}
                        maxLength={40}
                        onChange={(e) => setEdits({ ...edits, [item.value]: { ...edit, en: e.target.value } })}
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[13px] font-semibold">简体中文</span>
                      <input
                        value={edit.zh}
                        maxLength={40}
                        onChange={(e) => setEdits({ ...edits, [item.value]: { ...edit, zh: e.target.value } })}
                        className={inputClass}
                      />
                    </label>
                  </div>
                  {changed && (
                    <button
                      type="button"
                      className={`${primaryButton} self-start`}
                      disabled={pending}
                      onClick={() => run(() => saveOptionLabel(group, item.value, edit), () => setNotice(t("saved")))}
                    >
                      {t("save")}
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {notice && (
        <p role="status" className="text-sm font-semibold">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
    </div>
  );
}
