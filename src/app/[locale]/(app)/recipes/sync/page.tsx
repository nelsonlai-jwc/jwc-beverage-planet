import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getOutlets, getViewer } from "@/lib/recipes/data";
import { indexOfLetter, splitReferences } from "@/lib/recipes/letters";
import { outletLabel } from "@/lib/recipes/outlets";
import { ingredientKey } from "@/lib/recipes/sync";
import { loadSyncSources } from "@/lib/recipes/sync-server";
import { STYLES, TEMPS, type FullVersion } from "@/lib/recipes/types";
import { getOptionLabels, orderOf, styleValues } from "@/lib/settings/options";
import { createClient } from "@/lib/supabase/server";
import { SyncPanel } from "@/components/recipes/SyncPanel";
import { card } from "@/components/recipes/ui";

// Super Admin: picked same-name recipes side by side, then AI writes one version to sync.
export default async function SyncRecipesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const t = await getTranslations("Recipes");
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  if (!viewer || viewer.role !== "ADMIN") notFound();

  const ids = [query.ids ?? []].flat().flatMap((v) => v.split(",")).filter(Boolean);
  const loaded = await loadSyncSources(supabase, ids);
  const back = (
    <Link href="/recipes?tab=sync" className="text-sm underline">
      {t("sync.back")}
    </Link>
  );
  if (!loaded) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p className={card}>{t("sync.cannotCompare")}</p>
      </div>
    );
  }

  const { sources, isPrep } = loaded;
  const outlets = await getOutlets(supabase);
  const columns = sources.map((s, n) => ({
    id: s.id,
    label: `${n + 1}. ${outletLabel(s, outlets, t("allOutletsOption"))} · V${s.version.version_no}`,
  }));

  // Every ingredient used by any version, in order of first use.
  const options = new Map<string, string>();
  for (const s of sources) for (const i of s.version.ingredients) options.set(ingredientKey(i), i.name);
  const amount = (v: FullVersion, key: string) => {
    const i = v.ingredients.find((x) => ingredientKey(x) === key);
    return i ? { text: `${i.quantity ?? "?"} ${i.unit ?? ""}`.trim(), notes: i.notes } : null;
  };
  const ingredientRows = [...options].map(([key, name]) => {
    const cells = sources.map((s) => amount(s.version, key));
    const texts = cells.map((c) => c?.text ?? null);
    return { key, name, cells, differs: new Set(texts).size > 1 };
  });

  const yieldText = (v: FullVersion) => (v.yield_quantity != null ? `${v.yield_quantity} ${v.yield_unit ?? ""}`.trim() : null);
  const settingRows = [
    ...(isPrep ? [] : [
      { label: t("fields.style"), values: sources.map((s) => (s.version.style ? t(`style.${s.version.style}`) : null)) },
      { label: t("fields.temperature"), values: sources.map((s) => (s.version.temperature ? t(`temp.${s.version.temperature}`) : null)) },
    ]),
    { label: t("fields.yield"), values: sources.map((s) => yieldText(s.version)) },
    { label: t("fields.cup_type"), values: sources.map((s) => s.version.cup_type) },
    { label: t("fields.serving_size"), values: sources.map((s) => s.version.serving_size) },
    { label: t("fields.garnish"), values: sources.map((s) => s.version.garnish) },
  ].map((row) => ({ ...row, differs: new Set(row.values.map((v) => v ?? null)).size > 1 }));

  const labels = await getOptionLabels();
  const diffRow = "bg-brand-orange/25";
  const th = "min-w-44 border-b border-black/10 p-2 text-left align-top";
  const firstCol = "sticky left-0 z-10 min-w-32 max-w-40 border-b border-black/10 p-2 text-left align-top font-semibold";

  return (
    <div className="flex flex-col gap-6">
      {back}
      <div className="flex flex-col gap-1.5">
        <h1 className="font-serif text-[32px] font-normal">{t("sync.title", { name: sources[0].version.product_name ?? "" })}</h1>
        <p className="text-sm text-[#3d3f3a]">{t("sync.compareIntro")}</p>
      </div>

      <section className={card} aria-labelledby="sync-compare">
        <h2 id="sync-compare" className="text-base font-semibold">
          {t("sync.compareTitle")}
        </h2>
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-[#3d3f3a]">
          <span className={`inline-block h-3 w-6 rounded ${diffRow}`} aria-hidden />
          {t("sync.legendDiffers")}
        </p>
        <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={`${firstCol} bg-white`} />
                {columns.map((c) => (
                  <th key={c.id} scope="col" className={`${th} font-semibold`}>
                    <Link href={`/recipes/${c.id}`} className="underline">
                      {c.label}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th colSpan={columns.length + 1} scope="colgroup" className="sticky left-0 bg-white pt-4 pb-1 text-left text-xs uppercase tracking-wide text-[#3d3f3a]">
                  {t("sections.ingredients")}
                </th>
              </tr>
              {ingredientRows.map((row) => (
                <tr key={row.key} className={row.differs ? diffRow : ""}>
                  <th scope="row" className={`${firstCol} ${row.differs ? "bg-[#ffe3d6]" : "bg-white"}`}>
                    {row.name}
                  </th>
                  {row.cells.map((cell, n) => (
                    <td key={columns[n].id} className={th}>
                      {cell ? (
                        <>
                          {cell.text}
                          {cell.notes && <span className="block text-xs text-[#3d3f3a]">{cell.notes}</span>}
                        </>
                      ) : (
                        <span className="text-[#3d3f3a]">{t("sync.notUsed")}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th colSpan={columns.length + 1} scope="colgroup" className="sticky left-0 bg-white pt-4 pb-1 text-left text-xs uppercase tracking-wide text-[#3d3f3a]">
                  {t("sync.settings")}
                </th>
              </tr>
              {settingRows.map((row) => (
                <tr key={row.label} className={row.differs ? diffRow : ""}>
                  <th scope="row" className={`${firstCol} ${row.differs ? "bg-[#ffe3d6]" : "bg-white"}`}>
                    {row.label}
                  </th>
                  {row.values.map((value, n) => (
                    <td key={columns[n].id} className={th}>
                      {value ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th colSpan={columns.length + 1} scope="colgroup" className="sticky left-0 bg-white pt-4 pb-1 text-left text-xs uppercase tracking-wide text-[#3d3f3a]">
                  {t("sections.method")}
                </th>
              </tr>
              <tr>
                <th scope="row" className={`${firstCol} bg-white`}>
                  {t("sync.steps")}
                </th>
                {sources.map((s, n) => (
                  <td key={columns[n].id} className={th}>
                    <ol className="flex list-decimal flex-col gap-1.5 pl-5">
                      {s.version.steps.map((step) => (
                        <li key={step.step_no}>
                          {splitReferences(step.instruction, s.version.ingredients.length).map((part, k) =>
                            "letter" in part ? (
                              <strong key={k}>
                                {s.version.ingredients[indexOfLetter(part.letter)]?.name ?? `[${part.letter}]`}
                              </strong>
                            ) : (
                              <span key={k}>{part.text}</span>
                            ),
                          )}
                        </li>
                      ))}
                    </ol>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <SyncPanel
        recipeIds={sources.map((s) => s.id)}
        columns={columns}
        isPrep={isPrep}
        options={[...options].map(([key, name]) => ({ key, name }))}
        styles={styleValues(labels, STYLES).filter((s) => s !== "PREP_MATERIAL")}
        temps={orderOf(labels, "TEMP", TEMPS)}
      />
    </div>
  );
}

