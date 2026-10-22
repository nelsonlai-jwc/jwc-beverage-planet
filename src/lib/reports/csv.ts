const cell = (value: string | number | null | undefined) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

// CSV with a metadata block (report, currency, basis, filters, time) above the table (ch. 15.1).
export function toCsv(meta: [string, string][], header: string[], rows: (string | number | null)[][]) {
  return [
    ...meta.map(([key, value]) => [cell(key), cell(value)].join(",")),
    "",
    header.map(cell).join(","),
    ...rows.map((row) => row.map(cell).join(",")),
  ].join("\n");
}
