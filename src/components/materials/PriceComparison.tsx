import { divide, formatMoney, formatUnitCost } from "@/lib/materials/decimal";

/** Old price, new price and percentage change, for price proposals (ch. 19.3). */
export function PriceComparison({
  oldPrice,
  newPrice,
  unit,
  quantity,
  labels,
}: {
  oldPrice: number | null;
  newPrice: number;
  unit: string;
  quantity?: number;
  labels: { old: string; new: string; change: string };
}) {
  const unitCost = quantity ? divide(String(newPrice), String(quantity)) : null;
  const change = oldPrice && oldPrice > 0 ? ((newPrice - oldPrice) / oldPrice) * 100 : null;
  return (
    <dl className="grid grid-cols-3 gap-2 text-sm">
      <div>
        <dt className="text-[#3d3f3a]">{labels.old}</dt>
        <dd className="font-semibold tabular-nums">{oldPrice != null ? `RM${formatMoney(oldPrice)}` : "—"}</dd>
      </div>
      <div>
        <dt className="text-[#3d3f3a]">{labels.new}</dt>
        <dd className="font-semibold tabular-nums">
          RM{formatMoney(newPrice)}
          {unitCost && unitCost !== "DIV_ZERO" && (
            <span className="block text-xs font-normal text-[#3d3f3a]">
              RM{formatUnitCost(unitCost)} / {unit}
            </span>
          )}
        </dd>
      </div>
      <div>
        <dt className="text-[#3d3f3a]">{labels.change}</dt>
        <dd className="font-semibold tabular-nums">
          {change !== null ? `${change > 0 ? "+" : ""}${change.toFixed(1)}%` : "—"}
        </dd>
      </div>
    </dl>
  );
}
