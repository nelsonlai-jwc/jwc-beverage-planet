"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { SettingResult } from "./actions";
import { BREWER_TYPES } from "@/components/settings/brewer-types";

export type EquipmentKind = "GRINDER" | "MACHINE" | "BREWER";

/** Form values as typed; blank optional fields are saved as empty. */
export type EquipmentInput = {
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
  rpmAdjustable?: boolean;
  rpmMin?: string;
  rpmMax?: string;
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

/** The outlets an item is for: every outlet (also later ones), or the ticked ones. */
export type EquipmentOutlets = { allOutlets: boolean; outletIds: string[] };

/** Super Admin adds (id null) or edits a grinder, espresso machine or hand brew kit, with its outlets. */
export async function saveEquipment(
  kind: EquipmentKind,
  id: string | null,
  input: EquipmentInput,
  outlets: EquipmentOutlets,
): Promise<SettingResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "NAME_REQUIRED" };
  if (name.length > 60) return { ok: false, error: "INVALID" };
  const common = {
    name,
    brand: text(input.brand, 60),
    model: text(input.model, 60),
    serial_number: text(input.serialNumber, 80),
    notes: text(input.notes, 500),
  };
  const supabase = await createClient();
  let error;
  let saved: { id: string }[] | null;
  if (kind === "GRINDER") {
    const burrSize = num(input.burrSizeMm);
    const scaleMin = num(input.scaleMin);
    const scaleMax = num(input.scaleMax);
    if (burrSize === undefined || scaleMin === undefined || scaleMax === undefined) return { ok: false, error: "NUMBER" };
    if (scaleMin !== null && scaleMax !== null && scaleMin >= scaleMax) return { ok: false, error: "SCALE_RANGE" };
    // Adjustable speed needs a whole-number RPM range; otherwise no range is kept.
    const rpmAdjustable = !!input.rpmAdjustable;
    const rpmMin = rpmAdjustable ? num(input.rpmMin) : null;
    const rpmMax = rpmAdjustable ? num(input.rpmMax) : null;
    if (
      rpmAdjustable &&
      (rpmMin == null || rpmMax == null || !Number.isInteger(rpmMin) || !Number.isInteger(rpmMax) ||
        rpmMin <= 0 || rpmMin >= rpmMax || rpmMax > 10000)
    )
      return { ok: false, error: "RPM_RANGE" };
    const values = {
      ...common,
      burr_type: ["FLAT", "CONICAL", "OTHER"].includes(input.burrType ?? "") ? input.burrType! : null,
      burr_size_mm: burrSize,
      scale_type: input.scaleType === "STEPLESS" ? "STEPLESS" : "STEPPED",
      scale_min: scaleMin,
      scale_max: scaleMax,
      rpm_adjustable: rpmAdjustable,
      rpm_min: rpmMin,
      rpm_max: rpmMax,
    };
    ({ data: saved, error } = id
      ? await supabase.from("grinders").update(values).eq("id", id).select("id")
      : await supabase.from("grinders").insert(values).select("id"));
  } else if (kind === "BREWER") {
    const values = { ...common, brewer_type: (BREWER_TYPES as readonly string[]).includes(input.brewerType ?? "") ? input.brewerType : "POUR_OVER" };
    ({ data: saved, error } = id
      ? await supabase.from("brewers").update(values).eq("id", id).select("id")
      : await supabase.from("brewers").insert(values).select("id"));
  } else {
    const groups = num(input.groupCount);
    const temp = num(input.defaultWaterTempC);
    const pressure = num(input.defaultPressureBar);
    if (groups === undefined || temp === undefined || pressure === undefined) return { ok: false, error: "NUMBER" };
    const values = { ...common, group_count: groups, default_water_temp_c: temp, default_pressure_bar: pressure };
    ({ data: saved, error } = id
      ? await supabase.from("espresso_machines").update(values).eq("id", id).select("id")
      : await supabase.from("espresso_machines").insert(values).select("id"));
  }
  if (!error && saved?.[0]) {
    const result = await setEquipmentOutlets(kind, saved[0].id, outlets);
    if (!result.ok) return result;
  }
  revalidatePath("/", "layout");
  if (!error) return saved?.length ? { ok: true } : { ok: false, error: "NOT_ALLOWED" };
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

/**
 * Saves which outlets use one item. The Super Admin sets "All outlets" and any outlet;
 * an outlet Admin ticks or unticks only their own outlets (checked in the database).
 */
export async function setEquipmentOutlets(
  kind: EquipmentKind,
  id: string,
  outlets: EquipmentOutlets,
): Promise<SettingResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_equipment_outlets", {
    p_kind: kind,
    p_equipment_id: id,
    p_all_outlets: outlets.allOutlets,
    p_outlet_ids: outlets.allOutlets ? [] : outlets.outletIds,
  });
  revalidatePath("/", "layout");
  if (!error) return { ok: true };
  if (error.code === "42501") return { ok: false, error: "NOT_ALLOWED" };
  return { ok: false, error: "UNKNOWN" };
}
