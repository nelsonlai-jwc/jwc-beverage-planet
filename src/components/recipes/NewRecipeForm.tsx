"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Outlet } from "@/lib/recipes/types";
import { OutletChecklist } from "./OutletChecklist";
import { alertClass, card, inputClass, primaryButton } from "./ui";

// allowAll: an Admin can also make the recipe for every outlet.
export function NewRecipeForm({ outlets, allowAll }: { outlets: Outlet[]; allowAll: boolean }) {
  const t = useTranslations("Recipes");
  const router = useRouter();
  const [outletIds, setOutletIds] = useState<string[]>(outlets.length === 1 ? [outlets[0].id] : []);
  const [allOutlets, setAllOutlets] = useState(false);
  const [isPrep, setIsPrep] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!allOutlets && !outletIds.length) {
      setError(t("errors.OUTLET_REQUIRED"));
      return;
    }
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { data: versionId, error: rpcError } = await supabase.rpc("create_recipe", {
      p_outlet_ids: allOutlets ? [] : outletIds,
      p_all_outlets: allOutlets,
      p_is_prep: isPrep,
      p_product_name: name.trim(),
    });
    const { data: version } = versionId
      ? await supabase.from("recipe_versions").select("recipe_id").eq("id", versionId).single()
      : { data: null };
    if (rpcError || !version) {
      setPending(false);
      setError(`${t("actionFailed")} ${rpcError?.message ?? ""}`);
      return;
    }
    router.push(`/recipes/${version.recipe_id}/edit`);
  }

  return (
    <form onSubmit={handleSubmit} className={card}>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-semibold">{t("fields.outlets")}</legend>
        <OutletChecklist
          outlets={outlets}
          allowAll={allowAll}
          outletIds={outletIds}
          allOutlets={allOutlets}
          onChange={(ids, all) => {
            setOutletIds(ids);
            setAllOutlets(all);
          }}
        />
        <span className="text-[13px] text-[#3d3f3a]">
          {allOutlets ? `${t("allOutletsHint")} ` : ""}
          {t("outletFixed")}
        </span>
      </fieldset>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-semibold">{t("fields.type")}</legend>
        <div className="flex flex-wrap gap-2">
          {[false, true].map((prep) => (
            <label
              key={String(prep)}
              className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border-[1.5px] border-black px-4 text-sm ${
                isPrep === prep ? "bg-black font-semibold text-white" : ""
              }`}
            >
              <input type="radio" name="type" className="sr-only" checked={isPrep === prep} onChange={() => setIsPrep(prep)} />
              {prep ? t("prep") : t("drink")}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">{t("fields.productName")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputClass} />
      </label>
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className={primaryButton}>
        {t("createDraft")}
      </button>
    </form>
  );
}
