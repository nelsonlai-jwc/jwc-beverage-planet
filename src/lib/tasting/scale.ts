// Survey scale, barista championship style: every score 0-6 in steps of 0.5.
// Criteria per drink match private.survey_criteria in the database.

export type SurveyDrink = "BLACK_HOT" | "BLACK_ICED" | "MILK_HOT" | "MILK_ICED" | "FILTER" | "RECIPE";
export type SubjectType = "ESPRESSO" | "FILTER" | "RECIPE";
export type Audience = "OUTLET" | "PUBLIC";
export type Criterion =
  | "visual"
  | "taste_balance"
  | "tactile"
  | "flavor"
  | "aroma"
  | "aftertaste"
  | "acidity"
  | "body"
  | "balance"
  | "overall";
export type MilkAmount = "TOO_MUCH" | "RIGHT" | "TOO_LITTLE";

/** Cookie that remembers a phone on public surveys. */
export const DEVICE_COOKIE = "jwc_taster";

export const ESPRESSO_DRINKS: readonly SurveyDrink[] = ["BLACK_HOT", "BLACK_ICED", "MILK_HOT", "MILK_ICED"];

export const CRITERIA: Record<SurveyDrink, readonly Criterion[]> = {
  BLACK_HOT: ["taste_balance", "tactile", "flavor"],
  BLACK_ICED: ["taste_balance", "tactile", "flavor"],
  MILK_HOT: ["visual", "taste_balance", "tactile", "flavor"],
  MILK_ICED: ["visual", "taste_balance", "tactile", "flavor"],
  FILTER: ["aroma", "flavor", "aftertaste", "acidity", "body", "balance", "overall"],
  RECIPE: ["visual", "taste_balance", "tactile", "flavor", "overall"],
};

/** Which help texts a drink uses: black espresso, milk drink, filter or recipe. */
export const helpGroup = (drink: SurveyDrink) =>
  drink.startsWith("BLACK") ? "BLACK" : drink.startsWith("MILK") ? "MILK" : drink;

export const isMilk = (drink: string) => drink.startsWith("MILK");

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

/** Longest comment: a recipe survey asks for an opinion, the others a short note. */
export const commentMax = (drink: SurveyDrink) => (drink === "RECIPE" ? 500 : 140);

/** Word for a score: 0 Unacceptable … 6 Extraordinary (halves use the lower word). */
export const scaleWordKey = (score: number) => `scale.${Math.floor(score)}`;

export const isScore = (value: unknown): value is number =>
  typeof value === "number" && value >= 0 && value <= 6 && Number.isInteger(value * 2);
