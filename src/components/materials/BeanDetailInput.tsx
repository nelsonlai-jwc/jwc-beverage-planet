"use client";

import { useLocale } from "next-intl";
import { useId, useState } from "react";
import {
  beanDetailText,
  beanDetailValue,
  beanOptionName,
  type BeanDetailKind,
  type BeanOption,
} from "@/lib/materials/coffeeBean";
import { inputClass } from "./ui";

/**
 * Origin, variety or process of a Coffee Bean: a text box that offers the Settings list
 * while typing. A picked name is stored in English; anything else is stored as typed.
 */
export function BeanDetailInput({
  id,
  kind,
  options,
  value,
  onChange,
}: {
  id: string;
  kind: BeanDetailKind;
  options: BeanOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const locale = useLocale();
  const listId = useId();
  const [text, setText] = useState(() => beanDetailText(value, options, kind, locale));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const term = text.trim().toLowerCase();
  const matches = options.filter(
    (o) =>
      o.kind === kind &&
      o.active &&
      (!term || [o.en, o.zh, o.ms ?? ""].some((name) => name.toLowerCase().includes(term))),
  );
  const shown = open && matches.length > 0;

  function type(next: string) {
    setText(next);
    setOpen(true);
    setActive(-1);
    onChange(beanDetailValue(next, options, kind));
  }

  function pick(option: BeanOption) {
    setText(beanOptionName(option, locale));
    setOpen(false);
    setActive(-1);
    onChange(option.en);
  }

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        maxLength={100}
        value={text}
        onChange={(event) => type(event.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, matches.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (event.key === "Enter" && shown && active >= 0) {
            event.preventDefault();
            pick(matches[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        className={inputClass}
      />
      {shown && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-xl border border-black/20 bg-white py-1 shadow-lg"
        >
          {matches.map((option, index) => {
            const name = beanOptionName(option, locale);
            return (
              <li
                key={option.id}
                role="option"
                aria-selected={index === active}
                // Keep focus in the box so the pick lands before blur closes the list.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(option)}
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 text-sm ${
                  index === active ? "bg-brand-base/60" : "hover:bg-brand-base/40"
                }`}
              >
                <span>{name}</span>
                {name !== option.en && <span className="text-[13px] text-[#3d3f3a]">{option.en}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
