import { createClient as createAnonClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import type { Database } from "@/types/database";

export type OptionGroup = "STYLE" | "TEMP" | "STRENGTH";
export type OptionLabel = { group: OptionGroup; value: string; en: string; zh: string; sortOrder: number };

export const OPTION_LABELS_TAG = "option-labels";

/**
 * Display names and order of beverage style, temperature and strength, as the Admin
 * set them on the Settings page. Cached for all requests; saving on the Settings page
 * clears the cache. Empty when the database can't be reached (the built-in texts apply).
 */
export const getOptionLabels = unstable_cache(
  async (): Promise<OptionLabel[]> => {
    try {
      const supabase = createAnonClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } },
      );
      const { data } = await supabase
        .from("option_labels")
        .select("option_group, value, label_en, label_zh, sort_order")
        .order("sort_order");
      return (data ?? []).map((row) => ({
        group: row.option_group as OptionGroup,
        value: row.value,
        en: row.label_en,
        zh: row.label_zh,
        sortOrder: row.sort_order,
      }));
    } catch {
      return [];
    }
  },
  ["option-labels"],
  { tags: [OPTION_LABELS_TAG], revalidate: 3600 },
);

/** Values of one group in the Admin's order, e.g. ["COFFEE", "TEA", …]. */
export function orderOf<T extends string>(labels: OptionLabel[], group: OptionGroup, fallback: readonly T[]): T[] {
  const ordered = labels.filter((l) => l.group === group).map((l) => l.value as T);
  return [...ordered.filter((v) => fallback.includes(v)), ...fallback.filter((v) => !ordered.includes(v))];
}

type Messages = Record<string, Record<string, unknown>>;

/** Puts the Admin's names over the built-in texts wherever these options are shown. */
export function applyOptionLabels(messages: Messages, labels: OptionLabel[], locale: string): Messages {
  if (!labels.length) return messages;
  const name = (l: OptionLabel) => (locale === "zh-CN" ? l.zh : l.en);
  const pick = (group: OptionGroup) =>
    Object.fromEntries(labels.filter((l) => l.group === group).map((l) => [l.value, name(l)]));
  const styles = pick("STYLE");
  const temps = pick("TEMP");
  const strengths = pick("STRENGTH");
  const merge = (ns: string, key: string, values: Record<string, string>) => ({
    ...(messages[ns]?.[key] as Record<string, string> | undefined),
    ...values,
  });
  return {
    ...messages,
    Recipes: {
      ...messages.Recipes,
      style: merge("Recipes", "style", styles),
      temp: merge("Recipes", "temp", temps),
      strength: merge("Recipes", "strength", strengths),
    },
    Menus: { ...messages.Menus, styles: merge("Menus", "styles", styles), temps: merge("Menus", "temps", temps) },
  };
}
