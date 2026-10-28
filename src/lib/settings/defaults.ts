// Initial values from design plan V0.2 chapter 16 (Admin Settings).
// Material types, outlets, style, temp and strength now come from the database;
// unit, currency and language stay fixed here.
export const settingGroups = [
  { key: "strength", values: ["0", "1", "2", "3", "4", "5"] },
  {
    key: "beverageStyle",
    values: ["Coffee", "Tea", "Cocktail", "Mocktail", "Prep Material"],
  },
  { key: "unit", values: ["g", "ml"] },
  { key: "temp", values: ["Hot", "Cold", "Frozen"] },
  {
    key: "materialType",
    values: [
      "Alcoholic",
      "Liquor",
      "Cordial Tincture",
      "Tincture",
      "Cordial",
      "Syrup",
      "Base",
      "Juice",
      "Sauce",
      "Other",
    ],
  },
  {
    key: "outlet",
    values: [
      "JB - Brooos & Co",
      "JB - The Factory 30",
      "JB - You Bar",
      "KL - Coffee Mamak",
      "KL - Neighbourclub",
      "KL - The Messengers",
      "JB - Cabinet 8",
      "KL - Cabinet 8",
    ],
  },
  { key: "currency", values: ["MYR"] },
  { key: "language", values: ["en", "zh-CN"] },
] as const;
