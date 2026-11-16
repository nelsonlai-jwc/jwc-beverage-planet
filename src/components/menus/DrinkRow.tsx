"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  EstimateButton,
  PriceHint,
  isOverCostLimit,
  type DrinkCost,
  type EstimateState,
} from "@/components/menus/PriceHint";
import { inputClass } from "@/components/ui/styles";
import { categoryLabel, type FlatCategory } from "@/lib/menus/categories";

// Small buttons for the bar at the bottom of an open drink row.
const rowButton =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-[8px] border-[1.5px] border-black bg-white px-2 text-xs disabled:opacity-40";

// One drink on the menu: drag handle, name and price; details when opened.
export function DrinkRow({
  recipeId,
  name,
  position,
  price,
  categoryId,
  categories,
  showCategory,
  problems,
  archived,
  cost,
  estimate,
  onPrice,
  onCategory,
  onEstimate,
  onRemove,
}: {
  recipeId: string;
  name: string;
  position: number;
  price: string;
  categoryId: string;
  categories: FlatCategory[];
  showCategory: boolean;
  // Already translated problem messages for this drink.
  problems: string[];
  archived: boolean;
  cost: DrinkCost | undefined;
  estimate: EstimateState | undefined;
  onPrice: (price: string) => void;
  onCategory: (categoryId: string) => void;
  onEstimate: (state: EstimateState) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("Menus");
  const [open, setOpen] = useState(false);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: recipeId, disabled: archived });
  const over = isOverCostLimit(cost, price);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative flex flex-col gap-2 rounded-[14px] border-[1.5px] bg-white p-2 sm:p-3 ${
        problems.length ? "border-[#c4161c]" : "border-black/15"
      } ${isDragging ? "z-10 shadow-lg" : ""}`}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          disabled={archived}
          aria-label={t("dragFor", { name })}
          className="flex h-10 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-[8px] text-lg text-black/50 hover:bg-black/5 active:cursor-grabbing disabled:opacity-30"
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={t(open ? "hideDetailsFor" : "showDetailsFor", { name })}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span aria-hidden className={`shrink-0 text-xs transition-transform ${open ? "rotate-90" : ""}`}>
            ▶
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="break-words font-semibold">
              {position}. {name}
            </span>
            {over && (
              <span className="shrink-0 rounded-full bg-[#c4161c] px-2 py-0.5 text-[11px] font-semibold text-white">
                {t("pricing.overShort")}
              </span>
            )}
          </span>
        </button>
        <label className="flex shrink-0 items-center gap-1.5 text-sm">
          <span className="hidden font-semibold sm:inline">MYR</span>
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            disabled={archived}
            aria-label={t("priceFor", { name })}
            value={price}
            onChange={(event) => onPrice(event.target.value)}
            placeholder="MYR"
            className={`${inputClass} w-20 sm:w-28 sm:placeholder:text-transparent`}
          />
        </label>
      </div>
      {problems.map((message) => (
        <span key={message} className="pl-10 text-[13px] font-semibold text-[#c4161c]">
          {message}
        </span>
      ))}

      {open && (
        <div className="flex flex-col gap-2 pl-10">
          {/* Category right under the name, stretching to the price box's right edge. */}
          {showCategory && (
            <select
              disabled={archived}
              aria-label={t("categoryFor", { name })}
              value={categoryId}
              onChange={(event) => onCategory(event.target.value)}
              className="h-8 w-full rounded-[8px] border-[1.5px] border-black bg-white px-2 text-xs disabled:opacity-40"
            >
              <option value="">{t("uncategorized")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {categoryLabel(category)}
                </option>
              ))}
            </select>
          )}
          {!archived && <PriceHint cost={cost} price={price} estimate={estimate} />}
          {/* The row's buttons, small, in one bar at the bottom. */}
          <div className="flex items-center justify-end gap-1.5">
            {!archived && (
              <EstimateButton
                recipeId={recipeId}
                name={name}
                state={estimate}
                onChange={onEstimate}
                className={rowButton}
              />
            )}
            <button
              type="button"
              disabled={archived}
              onClick={onRemove}
              className={`${rowButton} whitespace-nowrap`}
            >
              {t("remove")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
