"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SettingResult } from "./actions";

export type EquipmentKind = "GRINDER" | "MACHINE" | "BREWER";

/** Form values as typed; blank optional fields are saved as empty. */
export type EquipmentInput = {
  outletId: string;
  name: string;
  brand: string;
  model: string;
  serialNumber: string;
  notes: string;
  // Grinder
  burrType?: string;
  burrSizeMm?: string;
  scaleType?: string;
  scaleMin?: string;
  scaleMax?: string;
  // Espresso machine
  groupCount?: string;
  defaultWaterTempC?: string;
  defaultPressureBar?: string;
  // Filter brewer
  brewerType?: string;
};

const text = (value: string | undefined, max: number) => {
  const v = (value ?? "").trim();
  return v ? v.slice(0, max) : null;
};
/** Blank is null; anything else must be a number. */
const num = (value: string | undefined): number | null | undefined => {
  const v = (value ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Super Admin adds (id null) or edits a grinder or espresso machine. */
export async function saveEquipment(kind: EquipmentKind, id: string | null, input: EquipmentInput): Promise<SettingResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "NAME_REQUIRED" };
  if (name.length > 60 || !input.outletId) return { ok: false, error: "INVALID" };
  const common = {
    outlet_id: input.outletId,
    name,
    brand: text(input.brand, 60),
    model: text(input.model, 60),
    serial_number: text(input.serialNumber, 80),
    notes: text(input.notes, 500),
  };
  const supabase = await createClient();
  let error;
  if (kind === "GRINDER") {
    const burrSize = num(input.burrSizeMm);
    const scaleMin = num(input.scaleMin);
    const scaleMax = num(input.scaleMax);
    if (burrSize === undefined || scaleMin === undefined || scaleMax === undefined) return { ok: false, error: "NUMBER" };
    if (scaleMin !== null && scaleMax !== null && scaleMin >= scaleMax) return { ok: false, error: "SCALE_RANGE" };
    const values = {
      ...common,
      burr_type: ["FLAT", "CONICAL", "OTHER"].includes(input.burrType ?? "") ? input.burrType! : null,
      burr_size_mm: burrSize,
      scale_type: input.scaleType === "STEPLESS" ? "STEPLESS" : "STEPPED",
      scale_min: scaleMin,
      scale_max: scaleMax,
    };
    ({ error } = id
      ? await supabase.from("grinders").update(values).eq("id", id)
      : await supabase.from("grinders").insert(values));
  } else if (kind === "BREWER") {
    const values = { ...common, brewer_type: input.brewerType === "BATCH" ? "BATCH" : "POUR_OVER" };
    ({ error } = id
      ? await supabase.from("brewers").update(values).eq("id", id)
      : await supabase.from("brewers").insert(values));
  } else {
    const groups = num(input.groupCount);
    const temp = num(input.defaultWaterTempC);
    const pressure = num(input.defaultPressureBar);
    if (groups === undefined || temp === undefined || pressure === undefined) return { ok: false, error: "NUMBER" };
    const values = { ...common, group_count: groups, default_water_temp_c: temp, default_pressure_bar: pressure };
    ({ error } = id
      ? await supabase.from("espresso_machines").update(values).eq("id", id)
      : await supabase.from("espresso_machines").insert(values));
  }
  revalidatePath("/", "layout");
  if (!error) return { ok: true };
  if (error.code === "23505") return { ok: false, error: "DUPLICATE" };
  if (error.code === "23514") return { ok: false, error: "NUMBER" };
  if (error.code === "42501") return { ok: false, error: "NOT_ALLOWED" };
  return { ok: false, error: "UNKNOWN" };
}

/** Equipment is never deleted (records point at it); it is disabled instead. */
export async function setEquipmentActive(kind: EquipmentKind, id: string, active: boolean): Promise<SettingResult> {
  const supabase = await createClient();
  const table = kind === "GRINDER" ? "grinders" : kind === "BREWER" ? "brewers" : "espresso_machines";
  const { data, error } = await supabase.from(table).update({ is_active: active }).eq("id", id).select("id");
  revalidatePath("/", "layout");
  if (error) return { ok: false, error: "UNKNOWN" };
  return data?.length ? { ok: true } : { ok: false, error: "NOT_ALLOWED" };
}
