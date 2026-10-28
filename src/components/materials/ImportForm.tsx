"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { importItems } from "@/app/[locale]/(app)/raw-materials/actions";
import { useRouter } from "@/i18n/navigation";
import {
  checkMaterialFile,
  checkPackagingFile,
  type CheckedRow,
  type ImportKind,
} from "@/lib/materials/csv";
import { cardClass, errorClass, primaryButtonClass, secondaryButtonClass } from "./ui";

type Checked = { missingColumns: string[]; rows: CheckedRow<object>[] };

/** Upload a CSV, check every row, then import all rows at once. */
export function ImportForm({
  kind,
  locale,
  types,
  existingKeys,
  isAdmin,
}: {
  kind: ImportKind;
  locale: string;
  types: { id: string; name: string }[];
  existingKeys: string[];
  isAdmin: boolean;
}) {
  const t = useTranslations("RawMaterials.import");
  const te = useTranslations("RawMaterials.errors");
  const router = useRouter();
  const existing = useMemo(() => new Set(existingKeys), [existingKeys]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [approve, setApprove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function read(files: FileList | null) {
    const file = files?.[0];
    setError(null);
    setChecked(null);
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    setChecked(kind === "materials" ? checkMaterialFile(text, types, existing) : checkPackagingFile(text, existing));
  }

  const rows = checked?.rows ?? [];
  const bad = rows.filter((row) => row.errors.length > 0);
  const ready = checked && checked.missingColumns.length === 0 && rows.length > 0 && bad.length === 0;

  function submit() {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const result = await importItems(
        kind,
        rows.map((row) => row.row as Record<string, unknown>),
        isAdmin && approve,
      );
      if (!result.ok) {
        setError(te.has(result.error) ? te(result.error) : te("UNKNOWN"));
        return;
      }
      router.push(kind === "packaging" ? "/raw-materials?tab=packaging" : "/raw-materials");
      router.refresh();
    });
  }

  const nameOf = (row: CheckedRow<object>) => row.values.name || "—";

  return (
    <div className="flex flex-col gap-6">
      <section className={cardClass} aria-labelledby="import-file">
        <h2 id="import-file" className="text-base font-semibold">
          {t("step1")}
        </h2>
        <p className="text-sm text-[#3d3f3a]">{kind === "materials" ? t("materialsHint") : t("packagingHint")}</p>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/${locale}/raw-materials/import/template${kind === "packaging" ? "?tab=packaging" : ""}`}
            className={secondaryButtonClass}
          >
            {t("template")}
          </a>
          <label className={`${primaryButtonClass} cursor-pointer`}>
            {fileName ? t("chooseAgain") : t("choose")}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => read(event.target.files)}
            />
          </label>
        </div>
        {fileName && <p className="text-sm">{fileName}</p>}
      </section>

      {checked && (
        <section className={cardClass} aria-labelledby="import-check">
          <h2 id="import-check" className="text-base font-semibold">
            {t("step2")}
          </h2>
          {checked.missingColumns.length > 0 ? (
            <p role="alert" className={errorClass}>
              {t("missingColumns", { columns: checked.missingColumns.join(", ") })}
            </p>
          ) : rows.length === 0 ? (
            <p role="alert" className={errorClass}>
              {te("IMPORT_EMPTY")}
            </p>
          ) : (
            <>
              <p className="text-sm font-semibold" role="status">
                {bad.length === 0
                  ? t("allGood", { count: rows.length })
                  : t("someBad", { count: rows.length, bad: bad.length })}
              </p>
              <ul className="flex flex-col divide-y divide-black/10">
                {rows.map((row) => (
                  <li key={row.line} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-start sm:gap-4">
                    <span className="w-16 shrink-0 text-[#3d3f3a]">{t("line", { line: row.line })}</span>
                    <span className="min-w-0 flex-1 font-semibold break-words">
                      {nameOf(row)}
                      {row.values.brand && <span className="font-normal text-[#3d3f3a]"> · {row.values.brand}</span>}
                    </span>
                    {row.errors.length === 0 ? (
                      <span className="text-[#3d3f3a]">{t("ok")}</span>
                    ) : (
                      <span className="text-[#c4161c]">
                        {row.errors.map((code) => te.has(code) ? te(code) : code).join(" ")}
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
        <section className={cardClass} aria-labelledby="import-go">
          <h2 id="import-go" className="text-base font-semibold">
            {t("step3")}
          </h2>
          {isAdmin ? (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={approve}
                onChange={(event) => setApprove(event.target.checked)}
                className="size-5 accent-black"
              />
              {t("approveNow")}
            </label>
          ) : (
            <p className="text-sm text-[#3d3f3a]">{t("asDrafts")}</p>
          )}
          {error && (
            <p role="alert" className={errorClass}>
              {error}
            </p>
          )}
          <button type="button" disabled={pending} onClick={submit} className={`${primaryButtonClass} self-start`}>
            {pending ? t("importing") : t("submit", { count: rows.length })}
          </button>
        </section>
      )}
    </div>
  );
}
