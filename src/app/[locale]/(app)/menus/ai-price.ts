"use server";

import { generateText, Output } from "ai";
import { z } from "zod";
import { getViewer, loadFullVersion } from "@/lib/recipes/data";
import { createClient } from "@/lib/supabase/server";

// Same free-tier model list as the recipe AI review, tried in order.
const MODELS = [
  "anthropic/claude-haiku-5.5",
  "anthropic/claude-haiku-4.5",
  "google/gemini-2.5-flash",
  "deepseek/deepseek-v4-flash",
];

const estimateSchema = z.object({
  low: z.number(),
  high: z.number(),
  note: z.string(),
});

export type AiPriceEstimate = z.infer<typeof estimateSchema>;
export type AiPriceResult =
  | { ok: true; estimate: AiPriceEstimate }
  | { ok: false; error: "NOT_ALLOWED" | "NOT_FOUND" | "AI_FAILED" };

const SYSTEM = `You estimate typical cafe selling prices in Malaysia (MYR), from your general knowledge of Malaysian cafe menus. You cannot browse the web.
Given one drink (name, style, temperature, serving size, ingredients), give the usual price range a specialty cafe in Malaysia charges for a similar drink.
- low and high are prices in MYR with at most 2 decimals, low <= high.
- note: one short sentence in LANGUAGE on what the range is based on (e.g. "Typical for a hot matcha latte at specialty cafes in Kuala Lumpur").
- Do not consider the drink's cost; only the market price.`;

// AI price range estimate for a drink on a menu (Manager/Admin). Button-triggered, nothing stored.
export async function aiEstimatePrice(recipeId: string, locale: string): Promise<AiPriceResult> {
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer || (viewer.role !== "ADMIN" && viewer.role !== "MANAGER")) return { ok: false, error: "NOT_ALLOWED" };

  const { data: recipe } = await supabase
    .from("recipes")
    .select("current_approved_version_id")
    .eq("id", recipeId)
    .maybeSingle();
  if (!recipe?.current_approved_version_id) return { ok: false, error: "NOT_FOUND" };
  const version = await loadFullVersion(supabase, recipe.current_approved_version_id);
  if (!version) return { ok: false, error: "NOT_FOUND" };

  const input = {
    name: version.product_name,
    style: version.style,
    temperature: version.temperature,
    servingSize: version.serving_size,
    cupType: version.cup_type,
    ingredients: version.ingredients.map((i) => `${i.name}${i.quantity != null ? ` ${i.quantity} ${i.unit ?? ""}` : ""}`.trim()),
  };
  const language = locale === "en" ? "English" : "Simplified Chinese";

  for (const model of MODELS) {
    try {
      const { output } = await generateText({
        model,
        system: SYSTEM.replace("LANGUAGE", language),
        prompt: `Drink (JSON):\n${JSON.stringify(input, null, 1)}`,
        output: Output.object({ schema: estimateSchema }),
        temperature: 0,
        // Reasoning models (e.g. Gemini 2.5 Flash) spend part of this on thinking.
        maxOutputTokens: 4000,
      });
      if (!(output.low > 0) || !(output.high >= output.low)) throw new Error("Invalid range");
      console.info("AI price estimate done with", model);
      return { ok: true, estimate: output };
    } catch (error) {
      console.error("AI price estimate failed with", model, error);
    }
  }
  return { ok: false, error: "AI_FAILED" };
}
