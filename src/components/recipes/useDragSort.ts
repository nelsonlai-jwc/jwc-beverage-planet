"use client";

import { useRef, useState, type PointerEvent } from "react";

/**
 * Drag to reorder with a handle. Pointer events, so it works with a finger as well as
 * a mouse; the ↑ ↓ buttons stay for keyboards and screen readers.
 */
export function useDragSort<T>(items: T[], onMove: (next: T[]) => void) {
  const rows = useRef<(HTMLElement | null)[]>([]);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);

  function targetAt(y: number) {
    const index = rows.current.findIndex((row) => {
      if (!row) return false;
      const box = row.getBoundingClientRect();
      return y >= box.top && y <= box.bottom;
    });
    return index >= 0 && index < items.length ? index : null;
  }

  function reset() {
    setFrom(null);
    setTo(null);
  }

  return {
    rowRef: (index: number) => (row: HTMLElement | null) => {
      rows.current[index] = row;
    },
    dragging: from,
    over: to,
    handleProps: (index: number) => ({
      onPointerDown(event: PointerEvent<HTMLElement>) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setFrom(index);
        setTo(index);
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        if (from === null) return;
        const target = targetAt(event.clientY);
        if (target !== null) setTo(target);
      },
      onPointerUp() {
        if (from !== null && to !== null && from !== to) {
          const next = [...items];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          onMove(next);
        }
        reset();
      },
      onPointerCancel: reset,
      style: { touchAction: "none" as const },
    }),
  };
}
