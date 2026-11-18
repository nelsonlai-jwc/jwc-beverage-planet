// Tasting survey scale, barista championship style: every score 0-6 in steps of 0.5.

export type Drink = "ESPRESSO" | "MILK";
export type Criterion = "visual" | "taste_balance" | "tactile" | "flavor";
export type MilkAmount = "TOO_MUCH" | "RIGHT" | "TOO_LITTLE";

export const CRITERIA: Record<Drink, readonly Criterion[]> = {
  ESPRESSO: ["taste_balance", "tactile", "flavor"],
  MILK: ["visual", "taste_balance", "tactile", "flavor"],
};

export const FLAVOR_TAGS = [
  "FRUITY",
  "BERRY",
  "CITRUS",
  "STONE_FRUIT",
  "FLORAL",
  "CHOCOLATE",
  "CARAMEL",
  "NUTTY",
  "SPICY",
  "ROASTED",
] as const;

export const MILK_AMOUNTS: readonly MilkAmount[] = ["TOO_MUCH", "RIGHT", "TOO_LITTLE"];

/** Word for a score: 0 Unacceptable … 6 Extraordinary (halves use the lower word). */
export const scaleWordKey = (score: number) => `scale.${Math.floor(score)}`;

export const isScore = (value: unknown): value is number =>
  typeof value === "number" && value >= 0 && value <= 6 && Number.isInteger(value * 2);
