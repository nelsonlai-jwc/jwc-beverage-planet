import { createHash } from "node:crypto";
import { after } from "next/server";
import { translateTexts } from "@/lib/ai/translate";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type ContentEntry = { source: string; en: string; zh: string; ms: string; isManual: boolean };

/** Shows user-entered text in the viewer's language. */
export type Localizer = {
  /** The text in the viewer's language, or the original while no translation exists. */
  t: <T extends string | null | undefined>(text: T) => T | string;
  /** Translation row of a text shown translated (it differs from the original), else null. */
  translated: (text: string | null | undefined) => ContentEntry | null;
  /** Every text of the page shown translated, once each (for the "AI translated" note). */
  shown: () => ContentEntry[];
};

const hash = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const pick = (entry: ContentEntry, locale: string) =>
  locale === "zh-CN" ? entry.zh : locale === "ms" ? entry.ms : entry.en;

// AI calls per page view for texts without a translation yet; the rest follow on later views.
const MAX_NEW_TEXTS = 120;
const BATCH = 30;

/**
 * Loads the stored translations of these texts. Texts without one are translated by AI
 * in the background after the page is sent, so they show translated on a later view.
 */
export async function getLocalizer(texts: (string | null | undefined)[], locale: string): Promise<Localizer> {
  const unique = [...new Set(texts.filter((x): x is string => typeof x === "string" && x.trim() !== ""))];
  const entries = new Map<string, ContentEntry>();
  const supabase = await createClient();
  const hashes = unique.map(hash);
  for (let i = 0; i < hashes.length; i += 150) {
    const { data } = await supabase
      .from("content_translations")
      .select("source, en, zh, ms, is_manual")
      .in("source_hash", hashes.slice(i, i + 150));
    for (const row of data ?? []) {
      entries.set(row.source, { source: row.source, en: row.en, zh: row.zh, ms: row.ms, isManual: row.is_manual });
    }
  }

  const missing = unique.filter((text) => !entries.has(text)).slice(0, MAX_NEW_TEXTS);
  if (missing.length) {
    // The request's cookies can't be read once the page is sent, so keep the token now.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (token)
      after(async () => {
        const writer = createAnonClient<Database>(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            auth: { persistSession: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          },
        );
        for (let i = 0; i < missing.length; i += BATCH) {
          const batch = missing.slice(i, i + BATCH);
          const result = await translateTexts(batch);
          if (!result) return;
          const rows = batch.map((source, index) => ({ source, ...result[index] }));
          const { error } = await writer.rpc("save_ai_translations", { p_rows: rows });
          if (error) console.error("Saving translations failed", error);
        }
      });
  }

  const translated = (text: string | null | undefined) => {
    if (!text) return null;
    const entry = entries.get(text);
    return entry && pick(entry, locale) !== text ? entry : null;
  };
  return {
    shown: () => unique.flatMap((text) => translated(text) ?? []),
    t: (text) => {
      const entry = translated(text);
      return entry ? pick(entry, locale) : text;
    },
    translated,
  };
}
