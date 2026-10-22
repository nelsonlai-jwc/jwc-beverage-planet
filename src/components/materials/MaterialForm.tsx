"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import {
  saveMaterial,
  type MaterialInput,
} from "@/app/[locale]/(app)/raw-materials/actions";
import { Link, useRouter } from "@/i18n/navigation";
import { divide, formatUnitCost, isDecimal, isPositiveDecimal } from "@/lib/materials/decimal";
import { createClient } from "@/lib/supabase/client";
import {
  cardClass,
  errorClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "./ui";

type Match = { id: string; name: string; brand: string | null; no_brand: boolean };

export type MaterialFormValues = Omit<MaterialInput, "submit">;

const emptyValues: MaterialFormValues = {
  name: "",
  brand: "",
  noBrand: false,
  materialTypeId: "",
  specification: "",
  description: "",
  abv: "",
  bx: "",
  isCoffeeBean: false,
  packQuantity: "",
  unit: "ml",
  packDescription: "",
  price: "",
  freeReason: "",
};

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {hint && <p className="text-[13px] text-[#3d3f3a]">{hint}</p>}
    </div>
  );
}

export function MaterialForm({
  types,
  initial,
}: {
  types: { id: string; name: string }[];
  initial?: MaterialFormValues;
}) {
  const t = useTranslations("RawMaterials");
  const router = useRouter();
  const [values, setValues] = useState<MaterialFormValues>(initial ?? emptyValues);
  const [matches, setMatches] = useState<Match[]>([]);
  const [missing, setMissing] = useState<{ field: string; label: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof MaterialFormValues>(key: K, value: MaterialFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  // Search before adding: show products that already exist (ch. 19.1).
  useEffect(() => {
    const name = values.name.trim();
    if (name.length < 2) {
      setMatches([]);
      return;
    }
    const term = name.replace(/[,()%*\\]/g, " ");
    const timer = setTimeout(async () => {
      const supabase = createClient();
      let query = supabase
        .from("materials")
        .select("id, name, brand, no_brand")
        .ilike("name", `%${term}%`)
        .neq("status", "ARCHIVED")
        .limit(5);
      if (values.id) query = query.neq("id", values.id);
      const { data } = await query;
      setMatches(data ?? []);
    }, 300);
    return () => clearTimeout(timer);
  }, [values.name, values.id]);

  const unitCost = divide(values.price, values.packQuantity);
  const isFree = isDecimal(values.price) && !isPositiveDecimal(values.price);

  function costText() {
    if (unitCost === "DIV_ZERO" || (values.packQuantity !== "" && !isPositiveDecimal(values.packQuantity))) {
      return <span className={errorClass}>{t("form.packInvalid")}</span>;
    }
    if (unitCost === null) return <span className="text-[#3d3f3a]">{t("form.toBeFilled")}</span>;
    return (
      <span className="text-lg font-semibold tabular-nums">
        RM{formatUnitCost(unitCost)} / {values.unit}
      </span>
    );
  }

  function check(): { field: string; label: string }[] {
    const list: { field: string; label: string }[] = [];
    if (!values.name.trim()) list.push({ field: "name", label: t("form.name") });
    if (!values.noBrand && !values.brand.trim()) list.push({ field: "brand", label: t("form.brand") });
    if (!values.materialTypeId) list.push({ field: "type", label: t("form.type") });
    if (!isPositiveDecimal(values.packQuantity))
      list.push({ field: "packQuantity", label: t("form.packQuantity") });
    if (values.price !== "" && !isDecimal(values.price))
      list.push({ field: "price", label: t("form.price") });
    if (isFree && !values.freeReason.trim())
      list.push({ field: "freeReason", label: t("form.freeReason") });
    for (const key of ["abv", "bx"] as const) {
      const value = values[key];
      if (value !== "" && (!isDecimal(value) || Number(value) > 100))
        list.push({ field: key, label: t(`form.${key}`) });
    }
    return list;
  }

  function save(submit: boolean) {
    const list = check();
    setMissing(list);
    setError(null);
    if (list.length > 0) return;
    startTransition(async () => {
      const result = await saveMaterial({ ...values, submit });
      if (!result.ok) {
        setError(t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t("errors.UNKNOWN"));
        return;
      }
      router.push(`/raw-materials/${result.id}`);
      router.refresh();
    });
  }

  const summary = (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-[#3d3f3a]">{t("form.unitCostPreview")}</span>
      {costText()}
      {values.price === "" && (
        <span className="text-[13px] text-[#3d3f3a]">{t("form.priceMissingNote")}</span>
      )}
    </div>
  );

  return (
    <form
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"
      onSubmit={(event) => {
        event.preventDefault();
        save(true);
      }}
      noValidate
    >
      <div className="flex flex-col gap-6">
        {missing.length > 0 && (
          <div role="alert" className="rounded-[20px] border-[1.5px] border-brand-red bg-white p-5">
            <p className="text-sm font-semibold">{t("form.missingTitle")}</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {missing.map((item) => (
                <li key={item.field}>
                  <a href={`#${item.field}`} className="text-sm underline">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <section className={cardClass} aria-labelledby="identity-heading">
          <h2 id="identity-heading" className="text-base font-semibold">
            {t("form.identity")}
          </h2>
          <Field id="name" label={t("form.name")}>
            <input
              id="name"
              value={values.name}
              maxLength={120}
              onChange={(event) => set("name", event.target.value)}
              className={inputClass}
              autoComplete="off"
            />
          </Field>
          {matches.length > 0 && (
            <div className="flex flex-col gap-2 rounded-[14px] bg-brand-base/60 p-4">
              <p className="text-sm font-semibold">{t("form.matchesTitle")}</p>
              <p className="text-[13px] text-[#3d3f3a]">{t("form.matchesHint")}</p>
              <ul className="flex flex-col gap-1">
                {matches.map((match) => (
                  <li key={match.id}>
                    <Link href={`/raw-materials/${match.id}`} className="text-sm underline">
                      {match.name} · {match.no_brand ? t("noBrand") : match.brand}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="brand" label={t("form.brand")}>
              <input
                id="brand"
                value={values.brand}
                maxLength={120}
                disabled={values.noBrand}
                onChange={(event) => set("brand", event.target.value)}
                className={inputClass}
              />
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={values.noBrand}
                  onChange={(event) => {
                    set("noBrand", event.target.checked);
                    if (event.target.checked) set("brand", "");
                  }}
                  className="size-5 accent-black"
                />
                {t("form.noBrand")}
              </label>
            </Field>
            <Field id="type" label={t("form.type")}>
              <select
                id="type"
                value={values.materialTypeId}
                onChange={(event) => set("materialTypeId", event.target.value)}
                className={inputClass}
              >
                <option value="">{t("form.choose")}</option>
                {types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field id="specification" label={t("form.specification")} hint={t("form.specificationHint")}>
            <input
              id="specification"
              value={values.specification}
              maxLength={200}
              onChange={(event) => set("specification", event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field id="description" label={t("form.description")}>
            <textarea
              id="description"
              value={values.description}
              rows={3}
              onChange={(event) => set("description", event.target.value)}
              className="w-full rounded-[10px] border-[1.5px] border-black bg-white px-3.5 py-3 text-base"
            />
          </Field>
        </section>

        <section className={cardClass} aria-labelledby="pack-heading">
          <h2 id="pack-heading" className="text-base font-semibold">
            {t("form.packAndPrice")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <Field id="packQuantity" label={t("form.packQuantity")}>
              <input
                id="packQuantity"
                inputMode="decimal"
                value={values.packQuantity}
                onChange={(event) => set("packQuantity", event.target.value.replace(",", "."))}
                className={inputClass}
              />
            </Field>
            <Field id="unit" label={t("form.unit")}>
              <select
                id="unit"
                value={values.unit}
                onChange={(event) => set("unit", event.target.value as MaterialFormValues["unit"])}
                className={inputClass}
              >
                <option value="ml">ml</option>
                <option value="g">g</option>
              </select>
            </Field>
          </div>
          <Field id="price" label={t("form.price")} hint={t("form.priceHint")}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">RM</span>
              <input
                id="price"
                inputMode="decimal"
                value={values.price}
                onChange={(event) => set("price", event.target.value.replace(",", "."))}
                className={inputClass}
              />
            </div>
          </Field>
          {isFree && (
            <Field id="freeReason" label={t("form.freeReason")}>
              <input
                id="freeReason"
                value={values.freeReason}
                onChange={(event) => set("freeReason", event.target.value)}
                className={inputClass}
              />
            </Field>
          )}
          <Field id="packDescription" label={t("form.packDescription")}>
            <input
              id="packDescription"
              value={values.packDescription}
              onChange={(event) => set("packDescription", event.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="rounded-[14px] bg-brand-base/60 p-4 lg:hidden">{summary}</div>
        </section>

        <details className={cardClass} open={Boolean(values.abv || values.bx || values.isCoffeeBean)}>
          <summary className="cursor-pointer text-base font-semibold">{t("form.additional")}</summary>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="abv" label={t("form.abv")} hint={t("form.percentHint")}>
              <input
                id="abv"
                inputMode="decimal"
                value={values.abv}
                onChange={(event) => set("abv", event.target.value.replace(",", "."))}
                className={inputClass}
              />
            </Field>
            <Field id="bx" label={t("form.bx")} hint={t("form.percentHint")}>
              <input
                id="bx"
                inputMode="decimal"
                value={values.bx}
                onChange={(event) => set("bx", event.target.value.replace(",", "."))}
                className={inputClass}
              />
            </Field>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.isCoffeeBean}
              onChange={(event) => set("isCoffeeBean", event.target.checked)}
              className="size-5 accent-black"
            />
            {t("form.coffeeBean")}
          </label>
        </details>

        {error && (
          <p role="alert" className={errorClass}>
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={pending} onClick={() => save(false)} className={secondaryButtonClass}>
            {t("form.saveDraft")}
          </button>
          <button type="submit" disabled={pending} className={primaryButtonClass}>
            {pending ? t("form.saving") : t("form.submit")}
          </button>
        </div>
      </div>

      <aside className={`${cardClass} sticky top-6 hidden lg:flex`} aria-label={t("form.summary")}>
        <h2 className="text-base font-semibold">{t("form.summary")}</h2>
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-[#3d3f3a]">{t("form.name")}</dt>
            <dd className="text-right font-semibold">{values.name || "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[#3d3f3a]">{t("form.brand")}</dt>
            <dd className="text-right">{values.noBrand ? t("noBrand") : values.brand || "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[#3d3f3a]">{t("form.pack")}</dt>
            <dd className="text-right tabular-nums">
              {values.packQuantity ? `${values.packQuantity} ${values.unit}` : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[#3d3f3a]">{t("form.price")}</dt>
            <dd className="text-right tabular-nums">{values.price ? `RM${values.price}` : "—"}</dd>
          </div>
        </dl>
        <div className="border-t border-black/15 pt-4">{summary}</div>
      </aside>
    </form>
  );
}
