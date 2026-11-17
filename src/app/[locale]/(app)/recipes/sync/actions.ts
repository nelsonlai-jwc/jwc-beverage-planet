"use server";

import { generateText, Output } from "ai";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AI_MODELS } from "@/lib/ai/models";
import { getViewer } from "@/lib/recipes/data";
import { letterFor } from "@/lib/recipes/letters";
import { contentPayload, ingredientKey, type SyncContent } from "@/lib/recipes/sync";
import { loadSyncSources } from "@/lib/recipes/sync-server";
import { UNITS, type BeverageStyle, type BeverageTemp, type MeasureUnit } from "@/lib/recipes/types";
import { createClient } from "@/lib/supabase/server";

const proposalSchema = z.object({
  ingredients: z.array(
    z.object({
      key: z.string(),
      quantity: z.number().nullable(),
      unit: z.enum(UNITS as [MeasureUnit, ...MeasureUnit[]]),
      notes: z.string(),
    }),
  ),
  steps: z.array(z.string()),
  style: z.string().nullable(),
  temperature: z.string().nullable(),
  yieldQuantity: z.number().nullable(),
  yieldUnit: z.enum(UNITS as [MeasureUnit, ...MeasureUnit[]]).nullable(),
  cupType: z.string(),
  servingSize: z.string(),
  garnish: z.string(),
  reason: z.string(),
});

export type AiSyncResult =
  | { ok: true; content: SyncContent; reason: string }
  | { ok: false; error: "NOT_ALLOWED" | "NOT_FOUND" | "AI_FAILED" };

const SYSTEM = `You are a senior beverage R&D lead for a cafe chain. Several outlets have their own recipe for the same drink. Write ONE best, unified recipe that every outlet will use from now on.

Rules:
- Use ONLY ingredients from "ingredientOptions", referred to by their "key". Never invent an ingredient.
- Pick the quantity and unit that make the best drink; prefer what most versions agree on unless another version is clearly better.
- Steps: clear, complete and in a workable order, one action per step, for staff to follow exactly. Take the best-written parts of each version.
- In steps, refer to ingredients ONLY as [A], [B], [C] ..., where A is the 1st ingredient of YOUR ingredient list, B the 2nd, and so on (the letters in the source versions refer to their own lists, so re-letter them). Every ingredient in your list must appear as [X] in at least one step.
- Equipment and tools (shaker, blender, steam wand ...) are not ingredients.
- style and temperature must be one of the values used by the versions. Keep cupType, servingSize, garnish and yield from the best version (empty string / null when none has them).
- reason: 2 to 4 short sentences on what you chose and why (e.g. which version's amounts or steps you used).
- Write steps, notes, cupType, servingSize, garnish in the same language as the source steps. Write reason in LANGUAGE.`;

async function allowed() {
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  return viewer?.role === "ADMIN" ? supabase : null; // ADMIN = Super Admin only
}

export async function aiSyncRecipes(recipeIds: string[], locale: string): Promise<AiSyncResult> {
  const supabase = await allowed();
  if (!supabase) return { ok: false, error: "NOT_ALLOWED" };
  const loaded = await loadSyncSources(supabase, recipeIds);
  if (!loaded) return { ok: false, error: "NOT_FOUND" };

  const options = new Map<string, string>();
  for (const s of loaded.sources) for (const i of s.version.ingredients) options.set(ingredientKey(i), i.name);
  const styles = [...new Set(loaded.sources.map((s) => s.version.style).filter(Boolean))] as BeverageStyle[];
  const temps = [...new Set(loaded.sources.map((s) => s.version.temperature).filter(Boolean))] as BeverageTemp[];

  const input = {
    recipeType: loaded.isPrep ? "Prep (pre-made ingredient used in other drinks)" : "Drink",
    ingredientOptions: [...options].map(([key, name]) => ({ key, name })),
    styles,
    temperatures: temps,
    versions: loaded.sources.map((s, n) => ({
      version: n + 1,
      name: s.version.product_name,
      style: s.version.style,
      temperature: s.version.temperature,
      yield: s.version.yield_quantity != null ? `${s.version.yield_quantity} ${s.version.yield_unit ?? ""}` : null,
      cupType: s.version.cup_type,
      servingSize: s.version.serving_size,
      garnish: s.version.garnish,
      ingredients: s.version.ingredients.map((i, index) => ({
        letter: letterFor(index),
        key: ingredientKey(i),
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        notes: i.notes,
      })),
      steps: s.version.steps.map((step) => `${step.step_no}. ${step.instruction}`),
    })),
  };
  const language = locale === "zh-CN" ? "Simplified Chinese" : locale === "ms" ? "Malay" : "English";

  for (const model of AI_MODELS) {
    try {
      const { output } = await generateText({
        model,
        system: SYSTEM.replace("LANGUAGE", language),
        prompt: `Write the unified recipe. Data (JSON):\n${JSON.stringify(input, null, 1)}`,
        output: Output.object({ schema: proposalSchema }),
        temperature: 0,
        maxOutputTokens: 8000,
      });
      // Only ingredients the versions already use, each once.
      const seen = new Set<string>();
      const ingredients = output.ingredients.filter((i) => options.has(i.key) && !seen.has(i.key) && seen.add(i.key));
      if (!ingredients.length) throw new Error("No usable ingredients in the AI answer");
      console.info("AI recipe sync done with", model);
      const steps = output.steps.map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim()).filter(Boolean);
      return {
        ok: true,
        reason: output.reason,
        content: {
          style: loaded.isPrep
            ? "PREP_MATERIAL"
            : styles.includes(output.style as BeverageStyle)
              ? (output.style as BeverageStyle)
              : (styles[0] ?? null),
          temperature: temps.includes(output.temperature as BeverageTemp)
            ? (output.temperature as BeverageTemp)
            : (temps[0] ?? null),
          yield_quantity: output.yieldQuantity,
          yield_unit: output.yieldUnit,
          cup_type: output.cupType,
          serving_size: output.servingSize,
          garnish: output.garnish,
          change_summary: output.reason,
          ingredients: ingredients.map((i) => ({ key: i.key, quantity: i.quantity, unit: i.unit, notes: i.notes })),
          steps,
          step_media: steps.map(() => null),
          photo_recipe_ids: [],
        },
      };
    } catch (error) {
      console.error("AI recipe sync failed with", model, error);
    }
  }
  return { ok: false, error: "AI_FAILED" };
}

export type SyncResult =
  | { ok: true; count: number }
  | { ok: false; error: string; recipeId?: string; detail?: string };

export async function syncRecipes(recipeIds: string[], content: SyncContent): Promise<SyncResult> {
  const supabase = await allowed();
  if (!supabase) return { ok: false, error: "NOT_ALLOWED" };
  const { data, error } = await supabase.rpc("sync_recipes", {
    p_recipe_ids: recipeIds,
    p_content: contentPayload(content),
  });
  if (error) {
    let recipeId: string | undefined;
    let detail: string | undefined;
    try {
      const parsed = JSON.parse(error.details ?? "") as { recipe_id?: string; detail?: string | null };
      recipeId = parsed.recipe_id;
      detail = parsed.detail ?? undefined;
    } catch {
      detail = error.details ?? undefined;
    }
    return { ok: false, error: error.message, recipeId, detail };
  }
  revalidatePath("/", "layout");
  return { ok: true, count: (data as { count?: number } | null)?.count ?? recipeIds.length };
}
