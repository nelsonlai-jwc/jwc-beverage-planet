"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Outlet } from "@/lib/recipes/types";
import { alertClass, card, inputClass, primaryButton, secondaryButton } from "./ui";

type Props = {
  sourceRecipeId: string;
  sourceName: string;
  targets: Outlet[];
  deps: { id: string; name: string; depth: number }[];
  existing: { id: string; outletId: string; isPrep: boolean; name: string }[];
};

const COPY = "COPY";

export function CopyForm({ sourceRecipeId, sourceName, targets, deps, existing }: Props) {
  const t = useTranslations("Recipes");
  const router = useRouter();
  // Same key for repeated clicks, so only one draft is created (ch. 10).
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  const [outletId, setOutletId] = useState(targets.length === 1 ? targets[0].id : "");
  const [name, setName] = useState(sourceName);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [confirmedDuplicate, setConfirmedDuplicate] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const duplicate = existing.find((r) => r.outletId === outletId && !r.isPrep && norm(r.name) === norm(name));
  const outletPreps = existing.filter((r) => r.outletId === outletId && r.isPrep);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!outletId) {
      setError(t("errors.OUTLET_REQUIRED"));
      return;
    }
    if (duplicate && !confirmedDuplicate) return;
    setPending(true);
    setError(null);
    const prepMapping = Object.fromEntries(Object.entries(mapping).filter(([, value]) => value && value !== COPY));
    const { data, error: rpcError } = await createClient().rpc("copy_recipe", {
      p_source_recipe_id: sourceRecipeId,
      p_target_outlet_id: outletId,
      p_product_name: name.trim(),
      p_prep_mapping: prepMapping,
      p_idempotency_key: `${idempotencyKey}:${outletId}`,
    });
    if (rpcError || !data) {
      setPending(false);
      setError(`${t("actionFailed")} ${rpcError?.message ?? ""}`);
      return;
    }
    router.push(`/recipes/${(data as { recipe_id: string }).recipe_id}/edit`);
  }

  if (!targets.length) {
    return <p className={card}>{t("noCopyTargets")}</p>;
  }

  return (
    <form onSubmit={handleSubmit} className={card}>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">{t("targetOutlet")}</span>
        <select
          value={outletId}
          onChange={(e) => {
            setOutletId(e.target.value);
            setMapping({});
            setConfirmedDuplicate(false);
          }}
          className={inputClass}
        >
          {targets.length !== 1 && <option value="">{t("chooseOutlet")}</option>}
          {targets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">{t("fields.productName")}</span>
        <input
          value={name}
          maxLength={80}
          onChange={(e) => {
            setName(e.target.value);
            setConfirmedDuplicate(false);
          }}
          className={inputClass}
        />
      </label>

      {deps.length > 0 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold">{t("prepDependencies")}</legend>
          <p className="text-[13px] text-[#3d3f3a]">{t("prepDependenciesHint")}</p>
          {deps.map((dep) => (
            <label key={dep.id} className="flex flex-col gap-1.5" style={{ paddingLeft: `${(dep.depth - 1) * 16}px` }}>
              <span className="text-sm">{dep.name}</span>
              <select
                value={mapping[dep.id] ?? COPY}
                disabled={!outletId}
                onChange={(e) => setMapping({ ...mapping, [dep.id]: e.target.value })}
                className={inputClass}
              >
                <option value={COPY}>{t("copyAsDraft")}</option>
                {outletPreps.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t("useExistingPrep", { name: p.name })}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
      )}

      <p className="text-[13px] text-[#3d3f3a]">{t("copyNote")}</p>

      {duplicate && !confirmedDuplicate && (
        <div role="alert" className={`${alertClass} flex flex-col gap-2`}>
          <p className="font-semibold">{t("duplicateName")}</p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/recipes/${duplicate.id}`} className={secondaryButton}>
              {t("useExisting")}
            </Link>
            <button type="button" className={secondaryButton} onClick={() => setConfirmedDuplicate(true)}>
              {t("createAnother")}
            </button>
            <Link href={`/recipes/${sourceRecipeId}`} className={secondaryButton}>
              {t("cancel")}
            </Link>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className={alertClass}>
          {error}
        </p>
      )}
      <button type="submit" disabled={pending || (Boolean(duplicate) && !confirmedDuplicate)} className={primaryButton}>
        {t("copyNow")}
      </button>
    </form>
  );
}
