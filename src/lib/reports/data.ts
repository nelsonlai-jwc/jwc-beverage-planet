import type { SupabaseClient } from "@supabase/supabase-js";
import { asCost, type CostResult } from "@/lib/recipes/types";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

// Current cost estimate per recipe (its current approved version), keyed by recipe id.
export async function loadCurrentCosts(
  supabase: Client,
  outletId?: string,
): Promise<Map<string, { versionId: string; cost: CostResult }>> {
  const { data } = await supabase.rpc("report_current_costs", { p_outlet_id: outletId });
  const result = new Map<string, { versionId: string; cost: CostResult }>();
  for (const row of data ?? []) {
    const cost = asCost(row.cost);
    if (cost) result.set(row.recipe_id, { versionId: row.version_id, cost });
  }
  return result;
}

export type SnapshotLine = {
  id: string;
  parentId: string | null;
  lineType: string;
  displayName: string;
  quantity: number;
  unit: string;
  unitCost: number | null;
  lineCost: number | null;
};

export type Snapshot = {
  versionId: string;
  totalCost: number | null;
  isComplete: boolean;
  calculatedAt: string;
  lines: SnapshotLine[];
};

// Latest approval snapshot per recipe version, keyed by version id (ch. 14.3).
export async function loadApprovalSnapshots(
  supabase: Client,
  versionIds: string[],
  withLines = false,
): Promise<Map<string, Snapshot>> {
  const result = new Map<string, Snapshot>();
  if (versionIds.length === 0) return result;
  const { data } = await supabase
    .from("cost_snapshots")
    .select(
      `recipe_version_id, total_cost, is_complete, calculated_at,
       cost_snapshot_lines(id, parent_line_id, line_type, display_name, quantity, unit, unit_cost, line_cost)`,
    )
    .eq("reason", "RECIPE_APPROVAL")
    .in("recipe_version_id", versionIds)
    .order("calculated_at", { ascending: true });
  for (const row of data ?? []) {
    result.set(row.recipe_version_id, {
      versionId: row.recipe_version_id,
      totalCost: row.total_cost,
      isComplete: row.is_complete,
      calculatedAt: row.calculated_at,
      lines: withLines
        ? row.cost_snapshot_lines.map((l) => ({
            id: l.id,
            parentId: l.parent_line_id,
            lineType: l.line_type,
            displayName: l.display_name,
            quantity: l.quantity,
            unit: l.unit,
            unitCost: l.unit_cost,
            lineCost: l.line_cost,
          }))
        : [],
    });
  }
  return result;
}

// Live selling price per recipe from the outlet's published menus; one price per
// recipe per outlet is enforced on publish (O11).
export async function loadSellingPrices(supabase: Client): Promise<Map<string, number>> {
  const { data } = await supabase
    .from("menu_items")
    .select("recipe_id, price, menus!inner(status)")
    .eq("menus.status", "PUBLISHED");
  return new Map((data ?? []).map((row) => [row.recipe_id, row.price]));
}
