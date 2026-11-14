"use server";

import { generateText, Output } from "ai";
import { z } from "zod";
import { getRecipeCost, getViewer, loadFullVersion } from "@/lib/recipes/data";
import { letterFor } from "@/lib/recipes/letters";
import { RETURN_PRESETS } from "@/lib/recipes/return-presets";
import type { CostResult, FullVersion } from "@/lib/recipes/types";
import { createClient } from "@/lib/supabase/server";

// Models allowed on AI Gateway's free tier, tried in order; on Vercel the gateway
// signs in with the project's OIDC token. Any failure (free tier refuses the model,
// unparsable answer, ...) moves on to the next one.
const MODELS = [
  "anthropic/claude-haiku-5.5",
  "anthropic/claude-haiku-4.5",
  "google/gemini-2.5-flash",
  "deepseek/deepseek-v4-flash",
];

const reviewSchema = z.object({
  verdict: z.enum(["APPROVE", "CHECK", "RETURN"]),
  summary: z.string(),
  issues: z.array(
    z.object({
      preset: z.enum(RETURN_PRESETS.filter((key) => key !== "media") as [string, ...string[]]),
      where: z.string(),
      problem: z.string(),
    }),
  ),
  returnReason: z.string(),
});

export type AiReview = z.infer<typeof reviewSchema>;
export type AiReviewResult = { ok: true; review: AiReview } | { ok: false; error: "NOT_ALLOWED" | "NOT_FOUND" | "AI_FAILED" };

const SYSTEM = `You are a senior beverage R&D reviewer for a cafe chain. An Admin is about to approve or return a recipe version that a Manager submitted. Do a first-pass review to help the Admin; the Admin makes the final decision.

Check ONLY these problems. Each issue you report must use exactly one of these preset keys:
- drinkTypeIngredient: an ingredient does not fit the drink type (style / temperature), e.g. ice in a HOT drink.
- stepUnit: a step writes a unit different from the ingredient's unit (e.g. the ingredient is ml but the step says g).
- drinkTypeMethod: the method does not fit the drink type.
- unlistedIngredient: a step uses an ingredient that is not in the ingredient list.
- unusedIngredient: a listed ingredient is never used by any step (by its [X] letter or its name).
- quantity: a listed quantity is clearly unreasonable (far too much or too little).
- stepOrder: the steps are in an order that cannot work.
- unclearStep: a step is too unclear for staff to follow.
- missingSettings: a key setting is missing where it is essential, e.g. no extraction time for espresso, no temperature for heating.
- cupSize: cup type or serving size is filled in AND clearly does not fit the drink.
- costHigh: cost is clearly too high, or rose a lot versus the approved version without a reason in the change summary.

These are NOT problems; never report them:
- A step that does not write a quantity: it means the whole listed quantity of that ingredient is used.
- Empty yield, serving size, cup type, garnish, storage, shelf life, notes or taste fields.
- A step marked optional.
- Wording, formatting, style or "could be clearer" suggestions when staff can still follow it.
- Anything about photos or videos (you cannot see them).

Verdict:
- RETURN when at least one problem above is clearly present.
- CHECK when you suspect one of the problems above but are not sure.
- APPROVE when none of the problems above is present. Then issues is empty.

Output:
- "where" names the place, e.g. "Ingredient B: Milk" or "Step 3".
- "problem" is one short sentence.
- summary: one short sentence.
- returnReason: if verdict is RETURN or CHECK, one short line per issue telling the Manager exactly what to fix (e.g. "Step 2: write the milk in ml"), no bullets or numbering; otherwise an empty string.
- Write summary, where, problem and returnReason in LANGUAGE.`;

function describe(version: FullVersion, materialUnits: Map<string, string>) {
  const taste = Object.entries(version)
    .filter(([key, value]) => key.startsWith("taste_") && value != null)
    .map(([key, value]) => `${key.slice(6)} ${value}`)
    .join(", ");
  return {
    version: `V${version.version_no}`,
    productName: version.product_name,
    purpose: version.purpose,
    style: version.style,
    temperature: version.temperature,
    yield: version.yield_quantity != null ? `${version.yield_quantity} ${version.yield_unit ?? ""}` : null,
    servingSize: version.serving_size,
    cupType: version.cup_type,
    garnish: version.garnish,
    storage: version.storage_method,
    shelfLife: version.shelf_life,
    appearanceNotes: version.appearance_notes,
    tastingNotes: version.tasting_notes,
    taste: taste || null,
    changeSummary: version.change_summary,
    ingredients: version.ingredients.map((i, index) => ({
      letter: letterFor(index),
      name: i.name,
      kind: i.isPrep ? "prep recipe" : "raw material",
      quantity: i.quantity,
      unit: i.unit,
      purchaseUnit: i.material_id ? (materialUnits.get(i.material_id) ?? null) : null,
      notes: i.notes,
    })),
    packaging: version.packaging.map((p) => `${p.name} x ${p.pieces}`),
    steps: version.steps.map((s) => `${s.step_no}. ${s.instruction}`),
  };
}

function describeCost(cost: CostResult | null) {
  if (!cost) return null;
  return {
    total: cost.is_complete ? cost.total_cost : null,
    complete: cost.is_complete,
    problems: cost.incomplete_reasons.map((r) => r.message ?? r.code),
    lines: cost.lines.map((l) => `${l.display_name}: ${l.quantity} ${l.unit} = ${l.line_cost ?? "?"}`),
  };
}

export async function aiReviewRecipeVersion(versionId: string, locale: string): Promise<AiReviewResult> {
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer || viewer.role !== "ADMIN") return { ok: false, error: "NOT_ALLOWED" };

  const next = await loadFullVersion(supabase, versionId);
  if (!next || next.status !== "PENDING") return { ok: false, error: "NOT_FOUND" };
  const { data: recipe } = await supabase
    .from("recipes")
    .select("is_prep, current_approved_version_id")
    .eq("id", next.recipe_id)
    .maybeSingle();
  if (!recipe) return { ok: false, error: "NOT_FOUND" };

  const current = recipe.current_approved_version_id ? await loadFullVersion(supabase, recipe.current_approved_version_id) : null;
  const materialIds = [
    ...new Set([...(current?.ingredients ?? []), ...next.ingredients].flatMap((i) => (i.material_id ? [i.material_id] : []))),
  ];
  const [nextCost, currentCost, units] = await Promise.all([
    getRecipeCost(supabase, next.id),
    current ? getRecipeCost(supabase, current.id) : null,
    materialIds.length
      ? supabase.from("material_current_costs").select("material_id, unit").in("material_id", materialIds)
      : Promise.resolve({
          data: [] as { material_id: string | null; unit: string | null }[],
        }),
  ]);
  const materialUnits = new Map(
    (units.data ?? []).flatMap((u) => (u.material_id && u.unit ? [[u.material_id, u.unit] as const] : [])),
  );

  const input = {
    recipeType: recipe.is_prep ? "Prep (pre-made ingredient used in other drinks)" : "Drink",
    submitted: {
      ...describe(next, materialUnits),
      cost: describeCost(nextCost),
    },
    currentlyApproved: current ? { ...describe(current, materialUnits), cost: describeCost(currentCost) } : null,
  };
  const language = locale === "en" ? "English" : "Simplified Chinese";

  for (const model of MODELS) {
    try {
      const { output } = await generateText({
        model,
        system: SYSTEM.replace("LANGUAGE", language),
        prompt: `Review this submitted recipe version. Data (JSON):\n${JSON.stringify(input, null, 1)}`,
        output: Output.object({ schema: reviewSchema }),
        // Reasoning models (e.g. Gemini 2.5 Flash) spend part of this on thinking.
        maxOutputTokens: 8000,
      });
      console.info("AI review done with", model);
      return { ok: true, review: output };
    } catch (error) {
      console.error("AI review failed with", model, error);
    }
  }
  return { ok: false, error: "AI_FAILED" };
}
