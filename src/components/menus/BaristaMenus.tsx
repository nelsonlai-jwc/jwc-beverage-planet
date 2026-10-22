import { useFormatter, useTranslations } from "next-intl";
import { cardClass, mutedText } from "@/components/ui/styles";
import type { MenuRecipe } from "@/lib/menus/recipes";

type Menu = {
  id: string;
  name: string;
  items: { price: number; recipe: MenuRecipe | null }[];
};

export function BaristaMenus({ menus }: { menus: Menu[] }) {
  const t = useTranslations("Menus");
  const format = useFormatter();

  if (menus.length === 0) {
    return <p className={`${cardClass} text-sm`}>{t("noPublishedMenus")}</p>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {menus.map((menu) => (
        <section key={menu.id} className={`${cardClass} flex flex-col gap-3`} aria-label={menu.name}>
          <h2 className="text-lg font-semibold">{menu.name}</h2>
          <ul className="flex flex-col divide-y divide-black/10">
            {menu.items.map((item, index) => (
              <li key={item.recipe?.id ?? index} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex min-w-0 flex-col">
                  <span className="font-semibold">{item.recipe?.productName ?? "—"}</span>
                  {item.recipe && (
                    <span className={mutedText}>
                      {[
                        item.recipe.style && t(`styles.${item.recipe.style}`),
                        item.recipe.temperature && t(`temps.${item.recipe.temperature}`),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-sm font-semibold">
                  {format.number(item.price, { style: "currency", currency: "MYR" })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
