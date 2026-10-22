import { useTranslations } from "next-intl";
import { cardClass, inputClass, labelClass, primaryButton } from "@/components/ui/styles";

export type Filter =
  | { name: string; label: string; type: "select"; value: string; options: { value: string; label: string }[] }
  | { name: string; label: string; type: "date"; value: string };

// Plain GET form: filters live in the URL, so a report can be bookmarked or shared.
export function FilterForm({ filters }: { filters: Filter[] }) {
  const t = useTranslations("Reports");
  return (
    <form method="get" className={`${cardClass} flex flex-col gap-4 print:hidden`}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {filters.map((filter) => (
          <div key={filter.name} className="flex flex-col gap-1.5">
            <label htmlFor={`filter-${filter.name}`} className={labelClass}>
              {filter.label}
            </label>
            {filter.type === "select" ? (
              <select
                id={`filter-${filter.name}`}
                name={filter.name}
                defaultValue={filter.value}
                className={inputClass}
              >
                {filter.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`filter-${filter.name}`}
                type="date"
                name={filter.name}
                defaultValue={filter.value}
                className={inputClass}
              />
            )}
          </div>
        ))}
      </div>
      <button type="submit" className={`${primaryButton} self-start`}>
        {t("apply")}
      </button>
    </form>
  );
}
