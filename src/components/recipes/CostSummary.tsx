import { useTranslations } from "next-intl";
import type { CostLine, CostResult } from "@/lib/recipes/types";
import { card } from "./ui";

export function formatMoney(value: number | null | undefined) {
  return value == null ? "—" : `RM ${Number(value).toFixed(2)}`;
}

// Manager-only estimated cost; kept apart from the Barista SOP (ch. 20.3).
export function CostSummary({ cost, title }: { cost: CostResult | null; title: string }) {
  const t = useTranslations("Recipes");
  return (
    <section className={card}>
      <h2 className="text-base font-semibold">{title}</h2>
      {!cost ? (
        <p className="text-sm text-[#3d3f3a]">{t("costUnavailable")}</p>
      ) : (
        <>
          <p className="text-2xl font-semibold tabular-nums">
            {cost.is_complete ? formatMoney(cost.total_cost) : t("costIncomplete")}
          </p>
          <ul className="flex flex-col divide-y divide-black/10 text-sm">
            {cost.lines.map((line, index) => (
              <CostRow key={index} line={line} />
            ))}
          </ul>
          {!cost.is_complete && (
            <ul className="flex flex-col gap-1 rounded-[10px] bg-brand-red/20 px-3 py-2 text-sm">
              {cost.incomplete_reasons.map((r, index) => (
                <li key={index}>{r.message ?? r.code}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function CostRow({ line }: { line: CostLine }) {
  return (
    <li className="flex justify-between gap-3 py-1.5">
      <span>
        {line.display_name}
        <span className="ml-1 text-[#3d3f3a]">
          {line.quantity} {line.unit}
        </span>
      </span>
      <span className="shrink-0 tabular-nums">{formatMoney(line.line_cost)}</span>
    </li>
  );
}
