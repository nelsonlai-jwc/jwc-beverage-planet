"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { inputClass } from "./ui";

export const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

/**
 * Tags of a beverage, picked like Google Maps labels: typing shows the person's own tag
 * history (nobody else sees it), each entry with ✕ to clear it from the history; the last
 * row creates a new tag. Clearing history never changes a recipe.
 */
export function TagInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const t = useTranslations("Recipes.tagInput");
  const supabase = useMemo(() => createClient(), []);
  const [history, setHistory] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase
      .from("recipe_tag_history")
      .select("name")
      .order("last_used_at", { ascending: false })
      .then(({ data }) => setHistory((data ?? []).map((row) => row.name)));
  }, [supabase]);

  // Close the list when clicking elsewhere.
  useEffect(() => {
    if (!open) return;
    const handler = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [open]);

  const typed = text.trim().slice(0, MAX_TAG_LENGTH);
  const full = tags.length >= MAX_TAGS;
  const suggestions = history.filter(
    (name) => !tags.some((tag) => same(tag, name)) && name.toLocaleLowerCase().includes(typed.toLocaleLowerCase()),
  );
  const canCreate =
    typed !== "" && !tags.some((tag) => same(tag, typed)) && !history.some((name) => same(name, typed));

  function add(name: string) {
    const tag = name.trim().slice(0, MAX_TAG_LENGTH);
    if (!tag || full || tags.some((x) => same(x, tag))) return;
    onChange([...tags, tag]);
    setText("");
    setHistory([tag, ...history.filter((x) => !same(x, tag))]);
    void supabase.from("recipe_tag_history").upsert({ name: tag, last_used_at: new Date().toISOString() });
  }

  function forget(name: string) {
    setHistory(history.filter((x) => x !== name));
    void supabase.from("recipe_tag_history").delete().eq("name", name);
  }

  return (
    <div className="flex flex-col gap-2" ref={box}>
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-[#eceee8] py-0.5 pl-3 pr-1 text-sm font-semibold"
            >
              {tag}
              <button
                type="button"
                aria-label={t("remove", { name: tag })}
                className="inline-flex size-6 items-center justify-center rounded-full hover:bg-black/10"
                onClick={() => onChange(tags.filter((x) => x !== tag))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <input
          value={text}
          maxLength={MAX_TAG_LENGTH}
          disabled={full}
          placeholder={full ? t("limit", { max: MAX_TAGS }) : t("placeholder")}
          aria-label={t("placeholder")}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const match = history.find((name) => same(name, typed));
              add(match ?? typed);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className={inputClass}
        />
        {open && !full && (suggestions.length > 0 || canCreate) && (
          <ul className="absolute inset-x-0 top-full z-20 mt-1 flex max-h-72 flex-col overflow-y-auto rounded-[12px] border-[1.5px] border-black bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.15)]">
            {suggestions.length > 0 && (
              <li className="px-3 pb-1 pt-2 text-xs font-semibold text-[#3d3f3a]">{t("history")}</li>
            )}
            {suggestions.map((name) => (
              <li key={name} className="flex items-center hover:bg-[#eceee8]">
                <button
                  type="button"
                  className="flex min-h-11 flex-1 items-center gap-3 px-3 text-left text-sm"
                  onClick={() => add(name)}
                >
                  <TagIcon />
                  {name}
                </button>
                <button
                  type="button"
                  aria-label={t("forget", { name })}
                  className="mr-1 inline-flex size-9 items-center justify-center rounded-full text-sm hover:bg-black/10"
                  onClick={() => forget(name)}
                >
                  ✕
                </button>
              </li>
            ))}
            {canCreate && (
              <li className="border-t border-black/10 first:border-0">
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm hover:bg-[#eceee8]"
                  onClick={() => add(typed)}
                >
                  <TagIcon />
                  <span>
                    <span className="font-semibold">{typed}</span>{" "}
                    <span className="text-[#3d3f3a]">{t("create")}</span>
                  </span>
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h8.3a2 2 0 0 1 1.5.7l4.2 5a2 2 0 0 1 0 2.6l-4.2 5a2 2 0 0 1-1.5.7H6.5A2.5 2.5 0 0 1 4 15.5z" />
    </svg>
  );
}
