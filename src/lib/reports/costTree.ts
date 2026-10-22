import type { CostNode } from "@/components/reports/CostLines";
import type { CostLine } from "@/lib/recipes/types";
import type { SnapshotLine } from "./data";

type LiveLine = CostLine & { incomplete_reason?: string | null };

export function fromLiveLines(lines: LiveLine[]): CostNode[] {
  return lines.map((line) => ({
    name: line.display_name,
    quantity: line.quantity ?? null,
    unit: line.unit ?? null,
    unitCost: line.unit_cost ?? null,
    lineCost: line.line_cost ?? null,
    reason: line.incomplete_reason ?? null,
    children: fromLiveLines((line.children ?? []) as LiveLine[]),
  }));
}

export function fromSnapshotLines(lines: SnapshotLine[], parentId: string | null = null): CostNode[] {
  return lines
    .filter((line) => line.parentId === parentId)
    .map((line) => ({
      name: line.displayName,
      quantity: line.quantity,
      unit: line.unit,
      unitCost: line.unitCost,
      lineCost: line.lineCost,
      reason: null,
      children: fromSnapshotLines(lines, line.id),
    }));
}
