// Only a material of type "Coffee Bean" can be used in Espresso or Filter calibration.
// Material types have no fixed code, so the type is found by name (the database does the same).
export function isCoffeeBeanType(typeName: string | null | undefined) {
  return (typeName ?? "").trim().toLowerCase() === "coffee bean";
}
