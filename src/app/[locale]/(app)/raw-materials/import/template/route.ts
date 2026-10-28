import { MATERIAL_COLUMNS, PACKAGING_COLUMNS, toCsv } from "@/lib/materials/csv";

/** Empty import file with one example row. */
export async function GET(request: Request) {
  const packaging = new URL(request.url).searchParams.get("tab") === "packaging";
  const csv = packaging
    ? toCsv(PACKAGING_COLUMNS, [["Cup Lid 90mm", "", "0.12", "", ""]])
    : toCsv(MATERIAL_COLUMNS, [
        ["Fresh Milk", "Farm Fresh", "no", "Other", "Full cream", "", "1000", "ml", "6.35", "", "Bottle", "", "", "no"],
      ]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${packaging ? "packaging" : "materials"}-template.csv"`,
    },
  });
}
