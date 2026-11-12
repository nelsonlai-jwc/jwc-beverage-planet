"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { approveRecipeVersion, returnRecipeVersion } from "@/app/[locale]/(app)/recipes/actions";
import { useRouter } from "@/i18n/navigation";
import type { ValidationError } from "@/lib/recipes/types";
import { alertClass, card, primaryButton, secondaryButton, textareaClass } from "./ui";

type Translate = (key: string, values?: Record<string, string | number>) => string;

// Preset return reasons; keys under Recipes.returnPresets in messages.
const RETURN_PRESETS = [
  "drinkTypeIngredient",
  "stepUnit",
  "drinkTypeMethod",
  "unlistedIngredient",
  "unusedIngredient",
  "quantity",
  "stepOrder",
  "unclearStep",
  "missingSettings",
  "cupSize",
  "costHigh",
  "media",
] as const;

type Props = { recipeId: string; versionId: string; menuNames: string[]; drinkNames: string[] };

export function ReviewActions({ versionId, menuNames, drinkNames }: Props) {
  const t = useTranslations("Recipes");
  const router = useRouter();
  // One key per page load, so a double click cannot approve twice (ch. 9.1).
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  const [mode, setMode] = useState<"idle" | "approve" | "return">("idle");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string[] | null>(null);

  async function approve() {
    setPending(true);
    setError(null);
    const result = await approveRecipeVersion(versionId, idempotencyKey);
    setPending(false);
    if (!result.ok) {
      setError(explainApprovalError(t, result.message ?? result.error, result.details));
      return;
    }
    router.push("/recipes?tab=pending&after=review");
  }

  // Tapping a preset adds its sentence as a line in the reason box; tapping again removes it.
  const reasonLines = reason.split("\n").map((line) => line.trim());
  function togglePreset(text: string) {
    const lines = reason.split("\n");
    if (lines.some((line) => line.trim() === text)) {
      setReason(lines.filter((line) => line.trim() !== text).join("\n"));
    } else {
      setReason(reason.trim() ? `${reason.replace(/\n+$/, "")}\n${text}` : text);
    }
  }

  async function sendBack() {
    if (!reason.trim()) {
      setError([t("returnReasonRequired")]);
      return;
    }
    setPending(true);
    setError(null);
    const result = await returnRecipeVersion(versionId, reason);
    setPending(false);
    if (!result.ok) {
      setError([`${t("actionFailed")} ${result.message ?? result.error}`]);
      return;
    }
    router.push("/recipes?tab=pending&after=review");
  }

  return (
    <section className={card}>
      <h2 className="text-base font-semibold">{t("decision")}</h2>
      {mode === "idle" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryButton} onClick={() => setMode("approve")}>
            {t("approve")}
          </button>
          <button type="button" className={secondaryButton} onClick={() => setMode("return")}>
            {t("return")}
          </button>
        </div>
      )}
      {mode === "approve" && (
        <div className="flex flex-col gap-3 text-sm">
          <p className="font-semibold">{t("approveConfirm")}</p>
          {menuNames.length > 0 && <p>{t("approveMenus", { menus: menuNames.join("、") })}</p>}
          {drinkNames.length > 0 && <p>{t("approveDrinks", { drinks: drinkNames.join("、") })}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryButton} disabled={pending} onClick={approve}>
              {t("approveNow")}
            </button>
            <button type="button" className={secondaryButton} disabled={pending} onClick={() => setMode("idle")}>
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
      {mode === "return" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {RETURN_PRESETS.map((key) => {
              const text = t(`returnPresets.${key}`);
              const selected = reasonLines.includes(text);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  disabled={pending}
                  onClick={() => togglePreset(text)}
                  className={`rounded-full border-[1.5px] border-black px-3 py-1.5 text-left text-sm disabled:opacity-50 ${
                    selected ? "bg-black text-white" : "bg-white"
                  }`}
                >
                  {text}
                </button>
              );
            })}
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">{t("returnReason")} *</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} className={textareaClass} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryButton} disabled={pending} onClick={sendBack}>
              {t("returnNow")}
            </button>
            <button type="button" className={secondaryButton} disabled={pending} onClick={() => setMode("idle")}>
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
      {error && (
        <ul role="alert" className={`${alertClass} flex flex-col gap-1`}>
          {error.map((line, index) => (
            <li key={index} className={index === 0 ? "font-semibold" : ""}>
              {line}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// approve_recipe_version raises RECIPE_INVALID / COST_INCOMPLETE / COST_UNAVAILABLE with details.
export function explainApprovalError(t: Translate, code: string, details?: string): string[] {
  if (code === "RECIPE_INVALID") {
    try {
      const items = JSON.parse(details ?? "[]") as ValidationError[];
      return [t("approveBlocked"), ...items.map((e) => `${t(`errors.${e.code}`)}${e.line ? ` (${t("line", { no: e.line })})` : ""}`)];
    } catch {
      return [t("approveBlocked")];
    }
  }
  if (code === "COST_INCOMPLETE") {
    try {
      const items = JSON.parse(details ?? "[]") as { code: string; message?: string }[];
      return [t("errors.COST_INCOMPLETE"), ...items.map((r) => r.message ?? r.code)];
    } catch {
      return [t("errors.COST_INCOMPLETE")];
    }
  }
  if (code === "COST_UNAVAILABLE") return [t("errors.COST_UNAVAILABLE")];
  return [`${t("actionFailed")} ${code}`];
}
