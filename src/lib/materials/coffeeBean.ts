// Only a material of type "Coffee Bean" can be used in Espresso or Filter calibration.
// Material types have no fixed code, so the type is found by name (the database does the same).
export function isCoffeeBeanType(typeName: string | null | undefined) {
  return (typeName ?? "").trim().toLowerCase() === "coffee bean";
}

// Origin, variety and process of a Coffee Bean: picked from the Settings lists or typed freely.
export const BEAN_DETAIL_KINDS = ["ORIGIN", "VARIETY", "PROCESS"] as const;
export type BeanDetailKind = (typeof BEAN_DETAIL_KINDS)[number];
export const BEAN_DETAIL_FIELD = { ORIGIN: "origin", VARIETY: "variety", PROCESS: "process" } as const;

export type BeanOption = { id: string; kind: BeanDetailKind; en: string; zh: string; ms: string | null; active: boolean };

/** The option's name in this language; Malay falls back to English. */
export function beanOptionName(option: { en: string; zh: string; ms: string | null }, locale: string) {
  if (locale === "zh-CN") return option.zh;
  if (locale === "ms") return option.ms || option.en;
  return option.en;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A stored value (the English name when picked from a list) shown in this language. */
export function beanDetailText(value: string | null | undefined, options: BeanOption[], kind: BeanDetailKind, locale: string) {
  if (!value) return "";
  const option = options.find((o) => o.kind === kind && same(o.en, value));
  return option ? beanOptionName(option, locale) : value;
}

/** What to store for typed text: a list option's English name when the text names it in any language. */
export function beanDetailValue(text: string, options: BeanOption[], kind: BeanDetailKind) {
  const option = options.find(
    (o) => o.kind === kind && (same(o.en, text) || same(o.zh, text) || (o.ms !== null && same(o.ms, text))),
  );
  return option ? option.en : text.trim();
}

/** Reads the Settings lists (rows of public.coffee_bean_options). */
export function toBeanOptions(
  rows: { id: string; kind: string; name_en: string; name_zh: string; name_ms: string | null; is_active: boolean }[] | null,
): BeanOption[] {
  return (rows ?? []).map((r) => ({
    id: r.id,
    kind: r.kind as BeanDetailKind,
    en: r.name_en,
    zh: r.name_zh,
    ms: r.name_ms,
    active: r.is_active,
  }));
}
