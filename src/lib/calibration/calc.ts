// Numbers shown on the calibration page; nothing here is stored.

/** Brew ratio as "1:2.0" (yield ÷ dose). */
export function brewRatio(dose: number, yieldG: number): string | null {
  if (!(dose > 0 && yieldG > 0)) return null;
  return `1:${(yieldG / dose).toFixed(1)}`;
}

/** Extraction yield % = TDS % × beverage weight ÷ dose. */
export function extractionYield(dose: number, yieldG: number, tds: number | null): number | null {
  if (!(dose > 0 && yieldG > 0 && tds && tds > 0)) return null;
  return Math.round(((tds * yieldG) / dose) * 10) / 10;
}

/** Days from roast date to the business date. */
export function daysOffRoast(roastDate: string | null, businessDate: string): number | null {
  if (!roastDate) return null;
  const days = Math.round((Date.parse(`${businessDate}T00:00:00Z`) - Date.parse(`${roastDate}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(days) ? days : null;
}

export type RangeCheck = "LOW" | "OK" | "HIGH";

export function checkRange(value: number, min: number, max: number): RangeCheck | null {
  if (!(value > 0)) return null;
  return value < min ? "LOW" : value > max ? "HIGH" : "OK";
}
