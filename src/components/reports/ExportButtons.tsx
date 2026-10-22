"use client";

import { useTranslations } from "next-intl";
import { secondaryButton } from "@/components/ui/styles";

export function ExportButtons({
  csv,
  filename,
  printable = false,
}: {
  csv: string;
  filename: string;
  printable?: boolean;
}) {
  const t = useTranslations("Reports");

  function download() {
    // BOM so Excel opens Chinese text as UTF-8.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <button type="button" onClick={download} className={secondaryButton}>
        {t("exportCsv")}
      </button>
      {printable && (
        <button type="button" onClick={() => window.print()} className={secondaryButton}>
          {t("print")}
        </button>
      )}
    </div>
  );
}
