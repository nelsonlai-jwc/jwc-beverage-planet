"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";

/** Message keys under "Toast" in messages/*.json. */
export type ToastKey =
  | "saved"
  | "created"
  | "submitted"
  | "approved"
  | "returned"
  | "deleted"
  | "deleteRequested"
  | "changeRequested"
  | "restored"
  | "imported"
  | "published"
  | "copied"
  | "invited"
  | "undone"
  | "withdrawn"
  | "reported";

type Item = { id: number; key: ToastKey };

let items: Item[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Show a short confirmation (e.g. "Saved") at the bottom of the screen for a few seconds. */
export function toast(key: ToastKey) {
  const id = nextId++;
  items = [...items.slice(-2), { id, key }];
  emit();
  window.setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, 3200);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Renders the toasts; mounted once in the app shell, so it survives page changes. */
export function Toaster() {
  const t = useTranslations("Toast");
  const list = useSyncExternalStore(subscribe, () => items, () => items);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 flex flex-col items-center gap-2 px-4 lg:items-end lg:px-8 print:hidden"
    >
      {list.map((item) => (
        <ToastRow key={item.id} label={t(item.key)} />
      ))}
    </div>
  );
}

function ToastRow({ label }: { label: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div
      role="status"
      className={`flex h-10 items-center gap-2 rounded-full border border-black/10 bg-white pr-4 pl-2 text-sm font-medium text-black shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-all duration-200 ${shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
    >
      <span className="flex size-6 items-center justify-center rounded-full bg-brand-green">
        <Check size={14} strokeWidth={2.5} aria-hidden />
      </span>
      {label}
    </div>
  );
}
