"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { saveManualTranslation } from "@/lib/content/actions";
import type { ContentEntry } from "@/lib/content/translations";

const input = "h-10 w-full rounded-[10px] border-[1.5px] border-black bg-white px-3 text-sm";

/**
 * "AI translated" label shown where user-entered text appears in another language.
 * An Admin can open it to correct each translation by hand.
 */
export function TranslationNote({ entries, canEdit }: { entries: ContentEntry[]; canEdit: boolean }) {
  const t = useTranslations("Content");
  const [open, setOpen] = useState(false);
  if (!entries.length) return null;
  const label = entries.some((e) => !e.isManual) ? t("aiTranslated") : t("translated");

  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-full border-[1.5px] border-brand-purple bg-brand-purple/15 px-2.5 py-0.5 text-xs font-semibold">
          {label}
        </span>
        {canEdit && (
          <button type="button" className="text-xs underline" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? t("close") : t("correct")}
          </button>
        )}
      </p>
      {open && (
        <ul className="flex flex-col gap-3 rounded-[12px] border border-black/15 bg-white p-3">
          {entries.map((entry) => (
            <EntryEditor key={entry.source} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EntryEditor({ entry }: { entry: ContentEntry }) {
  const t = useTranslations("Content");
  const router = useRouter();
  const [values, setValues] = useState({ en: entry.en, zh: entry.zh, ms: entry.ms });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const changed = values.en !== entry.en || values.zh !== entry.zh || values.ms !== entry.ms;
  const multiline = [entry.source, entry.en, entry.zh, entry.ms].some((text) => text.length > 40 || text.includes("\n"));
  const fields = [
    ["en", "English"],
    ["zh", "简体中文"],
    ["ms", "Bahasa Melayu"],
  ] as const;

  return (
    <li className="flex flex-col gap-2 border-b border-black/10 pb-3 last:border-0 last:pb-0">
      <p className="text-xs text-[#3d3f3a]">
        <span className="font-semibold">{t("original")}:</span> <span className="whitespace-pre-wrap">{entry.source}</span>
        {entry.isManual && <span className="ml-2 font-semibold">· {t("manual")}</span>}
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {fields.map(([key, name]) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-xs font-semibold">{name}</span>
            {multiline ? (
              <textarea
                value={values[key]}
                onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                className={`${input} h-auto min-h-20 py-2`}
              />
            ) : (
              <input value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} className={input} />
            )}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!changed || pending}
          className="inline-flex min-h-9 items-center justify-center rounded-full bg-black px-4 text-sm font-semibold text-white disabled:opacity-40"
          onClick={() =>
            start(async () => {
              const result = await saveManualTranslation(entry.source, values);
              setMessage(result.ok ? t("saved") : t(`errors.${result.error}`));
              if (result.ok) router.refresh();
            })
          }
        >
          {t("save")}
        </button>
        {message && (
          <span role="status" className="text-sm">
            {message}
          </span>
        )}
      </div>
    </li>
  );
}
