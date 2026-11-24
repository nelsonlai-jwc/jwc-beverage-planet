import { toCsv } from "@/lib/materials/csv";
import { RECIPE_IMPORT_COLUMNS } from "@/lib/recipes/csv-import";

/** Empty recipe import file with one example Drink and one example Prep. */
export async function GET() {
  const csv = toCsv(RECIPE_IMPORT_COLUMNS, [
    [
      "KL - Drink Lab",
      "Latte",
      "Drink",
      "Coffee",
      "Hot",
      "R&D",
      "",
      "Smooth milk coffee",
      "A Espresso Beans (Brand) 18 g; B Fresh Milk (Brand) 180 ml",
      "Paper Cup 8oz × 1",
      "1. Pull [A] as a double shot\n2. Steam [B] and pour",
    ],
    ["KL - Drink Lab", "Brown Sugar Syrup", "Prep", "", "", "R&D", "1000 ml", "", "A Brown Sugar 500 g; B Water 500 ml", "", "1. Boil [B]\n2. Stir in [A] until dissolved"],
  ]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="recipes-template.csv"',
    },
  });
}
