import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { BeverageTemp } from "@/lib/recipes/types";

/**
 * A drink's name with its temperature after it in small text, e.g. "Matcha Latte (Hot)"
 * (Nelson, 2026-11-17: names are entered without the temperature). Give no temperature for a
 * Prep or when none is set, and only the name shows.
 */
export function RecipeName({ name, temperature }: { name: ReactNode; temperature?: BeverageTemp | null }) {
  const t = useTranslations("Recipes");
  if (!temperature) return <>{name}</>;
  return (
    <>
      {name}{" "}
      <small className="whitespace-nowrap text-[0.75em] font-normal opacity-70">({t(`temp.${temperature}`)})</small>
    </>
  );
}

/** The same as plain text, for places that cannot style part of the text (e.g. a select option). */
export function recipeNameText(name: string, tempLabel: string | null | undefined) {
  return tempLabel ? `${name} (${tempLabel})` : name;
}

/** Placeholder for a translated sentence around a name, e.g. t("reviewTitle", { name: NAME_SLOT }). */
export const NAME_SLOT = "\u0000";

/** Puts a node (e.g. a RecipeName) where NAME_SLOT sits in an already translated sentence. */
export function fillNameSlot(text: string, node: ReactNode) {
  const [before, after = ""] = text.split(NAME_SLOT);
  return (
    <>
      {before}
      {node}
      {after}
    </>
  );
}
