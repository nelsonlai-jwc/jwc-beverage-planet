// Filter numbers shown on screen; nothing here is stored.

/** Water ÷ dose, e.g. 16.7 for 1:16.7. */
export function waterRatio(dose: number, water: number): number | null {
  if (!(dose > 0 && water > 0)) return null;
  return Math.round((water / dose) * 10) / 10;
}

/** Extraction yield % = TDS % × beverage weight ÷ dose. */
export function filterExtractionYield(dose: number, beverage: number | null, tds: number | null): number | null {
  if (!(dose > 0 && beverage && beverage > 0 && tds && tds > 0)) return null;
  return Math.round(((tds * beverage) / dose) * 10) / 10;
}

/** "3:05" from seconds. */
export function minutes(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
