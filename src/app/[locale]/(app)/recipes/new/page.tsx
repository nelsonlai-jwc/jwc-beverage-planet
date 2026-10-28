import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getOutlets, getViewer } from "@/lib/recipes/data";
import { createClient } from "@/lib/supabase/server";
import { NewRecipeForm } from "@/components/recipes/NewRecipeForm";
import { card } from "@/components/recipes/ui";

export default async function NewRecipePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Recipes");
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer || viewer.role === "BARISTA") return <p className={card}>{t("createNotAllowed")}</p>;
  const outlets = (await getOutlets(supabase)).filter((o) => viewer.managedOutletIds.includes(o.id));

  return (
    <div className="flex max-w-[560px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/recipes" className="text-sm underline">
          {t("backToList")}
        </Link>
        <h1 className="font-serif text-[32px] font-normal">{t("create")}</h1>
        <p className="text-sm text-[#3d3f3a]">{t("createIntro")}</p>
      </div>
      <NewRecipeForm outlets={outlets} />
    </div>
  );
}
