"use client";

import { useEffect } from "react";

/**
 * Keys 1, 2, 3 switch between the Feedback tabs (ignored while typing or with a modifier key).
 * Each tab link carries aria-keyshortcuts="1" / "2" / "3"; pressing the key clicks that link.
 */
export function FeedbackTabKeys() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (!/^[1-9]$/.test(event.key)) return;
      const link = document.querySelector<HTMLAnchorElement>(`nav a[aria-keyshortcuts="${event.key}"]`);
      if (!link) return;
      event.preventDefault();
      link.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
