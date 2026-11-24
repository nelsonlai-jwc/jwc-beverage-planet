"use client";

import { toast } from "@/components/ui/toast";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { importRecipes } from "@/app/[locale]/(app)/recipes/actions";
import { useRouter } from "@/i18n/navigation";
import {
  MAX_IMPORT_ROWS,
  checkRecipeFile,
  type CheckedRecipeRow,
  type ImportRecipeRow,
  type RecipeImportLookups,
} from "@/lib/recipes/csv-import";
import { alertClass, card, primaryButton, secondaryButton } from "./ui";

type Checked = { missingColumns: string[]; tooMany: boolean; rows: CheckedRecipeRow[] };

/** Upload a CSV of recipes, check every row, then create them all as drafts. */
export function ImportRecipesForm({ locale, lookups }: { locale: string; lookups: RecipeImportLookups }) {
  const t = useTranslations("Recipes.import");
  const tr = useTranslations("Recipes");
  const router = useRouter();
  const [fileName, setFileName] = useState<string | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function read(files: FileList | null) {
    const file = files?.[0];
    setError(null);
    setChecked(null);
    if (!file) return;
    setFileName(file.name);
    setChecked(checkRecipeFile(await file.text(), lookups));
  }

  const rows = checked?.rows ?? [];
  const bad = rows.filter((row) => row.errors.length > 0);
  const ready = checked && !checked.missingColumns.length && !checked.tooMany && rows.length > 0 && !bad.length;

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const result = await importRecipes(rows.map((row) => row.row as ImportRecipeRow));
      if (!result.ok) {
        const known = result.error !== "UNKNOWN" && tr.has(`actionErrors.${result.error}`) ? tr(`actionErrors.${result.error}`) : null;
        setError(known ?? `${tr("actionFailed")} ${"message" in result ? (result.message ?? "") : ""}`);
        return;
      }
      toast("imported");
      router.push("/recipes");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className={card} aria-labelledby="import-file">
        <h2 id="import-file" className="text-base font-semibold">
          {t("step1")}
        </h2>
        <p className="text-sm text-[#3d3f3a]">{t("hint")}</p>
        <p className="text-sm text-[#3d3f3a]">{t("formatHint")}</p>
        <div className="flex flex-wrap gap-2">
          <a href={`/${locale}/recipes/import/template`} className={secondaryButton}>
            {t("template")}
          </a>
          <label className={`${primaryButton} cursor-pointer`}>
            {fileName ? t("chooseAgain") : t("choose")}
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => read(event.target.files)} />
          </label>
        </div>
        {fileName && <p className="text-sm">{fileName}</p>}
      </section>

      {checked && (
        <section className={card} aria-labelledby="import-check">
          <h2 id="import-check" className="text-base font-semibold">
            {t("step2")}
          </h2>
          {checked.missingColumns.length > 0 ? (
            <p role="alert" className={alertClass}>
              {t("missingColumns", { columns: checked.missingColumns.join(", ") })}
            </p>
          ) : rows.length === 0 ? (
            <p role="alert" className={alertClass}>
              {t("empty")}
            </p>
          ) : checked.tooMany ? (
            <p role="alert" className={alertClass}>
              {t("tooMany", { max: MAX_IMPORT_ROWS })}
            </p>
          ) : (
            <>
              <p className="text-sm font-semibold" role="status">
                {bad.length === 0 ? t("allGood", { count: rows.length }) : t("someBad", { count: rows.length, bad: bad.length })}
              </p>
              <ul className="flex flex-col divide-y divide-black/10">
                {rows.map((row) => (
                  <li key={row.line} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-start sm:gap-4">
                    <span className="w-16 shrink-0 text-[#3d3f3a]">{t("line", { line: row.line })}</span>
                    <span className="min-w-0 flex-1 font-semibold break-words">
                      {row.values.product_name.trim() || "—"}
                      {row.values.outlet.trim() && (
                        <span className="font-normal text-[#3d3f3a]"> · {row.values.outlet.trim()}</span>
                      )}
                    </span>
                    {row.errors.length === 0 ? (
                      <span className="text-[#3d3f3a]">{t("ok")}</span>
                    ) : (
                      <span className="text-[#c4161c] sm:max-w-[55%]">
                        {row.errors.map((e) => t(`errors.${e.code}`, { name: e.name ?? "" })).join(" ")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {ready && (
        <section className={card} aria-labelledby="import-go">
          <h2 id="import-go" className="text-base font-semibold">
            {t("step3")}
          </h2>
          <p className="text-sm text-[#3d3f3a]">{t("asDrafts")}</p>
          {error && (
            <p role="alert" className={alertClass}>
              {error}
            </p>
          )}
          <button type="button" disabled={pending} onClick={submit} className={`${primaryButton} self-start`}>
            {pending ? t("importing") : t("submit", { count: rows.length })}
          </button>
        </section>
      )}
    </div>
  );
}
