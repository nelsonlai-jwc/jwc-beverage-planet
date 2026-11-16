import { generateText, Output } from "ai";
import { z } from "zod";
import { AI_MODELS } from "./models";

export type Translation = { en: string; zh: string; ms: string };

const SYSTEM = `You translate texts for a cafe chain's beverage recipe system in Malaysia.
For every input text, write it in English ("en"), Simplified Chinese ("zh") and Malay / Bahasa Melayu ("ms").
- The input can be in any of these languages, or mixed. Where it is already in a target language, keep it as written.
- Keep codes like [A], [B], numbers, units (g, ml, °C, s), brand names and product names of brands unchanged.
- Use the usual words of the coffee, tea and bar trade (e.g. espresso, latte, shaker, syrup).
- Translate only; do not add, explain or correct anything. Keep line breaks.
- Return exactly one item per input text, in the same order.`;

const schema = z.object({
  items: z.array(z.object({ en: z.string(), zh: z.string(), ms: z.string() })),
});

/**
 * English, Simplified Chinese and Malay versions of each text, in order.
 * Returns null when no model could translate them.
 */
export async function translateTexts(texts: string[]): Promise<Translation[] | null> {
  if (!texts.length) return [];
  for (const model of AI_MODELS) {
    try {
      const { output } = await generateText({
        model,
        system: SYSTEM,
        prompt: `Texts (JSON array):\n${JSON.stringify(texts)}`,
        output: Output.object({ schema }),
        temperature: 0,
        // Reasoning models (e.g. Gemini 2.5 Flash) spend part of this on thinking.
        maxOutputTokens: 8000,
      });
      if (output.items.length !== texts.length) throw new Error(`Got ${output.items.length} of ${texts.length}`);
      console.info("AI translation done with", model);
      return output.items.map((item) => ({ en: item.en.trim(), zh: item.zh.trim(), ms: item.ms.trim() }));
    } catch (error) {
      console.error("AI translation failed with", model, error);
    }
  }
  return null;
}
