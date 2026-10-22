import { useFormatter, useTranslations } from "next-intl";

export type CostNode = {
  name: string;
  quantity: number | null;
  unit: string | null;
  unitCost: number | null;
  lineCost: number | null;
  reason: string | null;
  children: CostNode[];
};

// One recipe's cost lines; Prep Material lines expand into their own lines (ch. 15.1).
export function CostLines({ lines, depth = 0 }: { lines: CostNode[]; depth?: number }) {
  const t = useTranslations("Reports");
  const format = useFormatter();
  const money = (value: number) =>
    format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  return (
    <ul className={depth ? "ml-4 border-l border-black/15 pl-3" : ""}>
      {lines.map((line, index) => (
        <li key={index} className="flex flex-col gap-1 py-1.5 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <span>
              {line.name}
              {line.quantity !== null && (
                <span className="text-[#3d3f3a]">
                  {" "}
                  · {format.number(line.quantity)} {line.unit}
                </span>
              )}
            </span>
            <span className={line.lineCost === null ? "font-semibold text-[#c4161c]" : "font-semibold"}>
              {line.lineCost === null
                ? t(`reasons.${line.reason ?? "UNKNOWN"}`)
                : `MYR ${money(line.lineCost)}`}
            </span>
          </div>
          {line.children.length > 0 && <CostLines lines={line.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}
