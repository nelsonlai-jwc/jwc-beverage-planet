"use client";

import { Clipboard, ClipboardCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { secondaryButton } from "@/components/ui/styles";
import { copyForClaude } from "@/app/[locale]/(app)/feedback/actions";

/** Copies the reports as a ready-to-paste task for Claude Code. */
export function CopyForClaudeButton({ ids, label }: { ids: string[]; label?: string }) {
  const t = useTranslations("Feedback");
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");

  async function copy() {
    setState("busy");
    const text = copyForClaude(ids).then((result) => {
      if (!result.ok) throw new Error("copy failed");
      return result.text;
    });
    try {
      // Safari only allows the clipboard during the click, so hand it a pending item.
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/plain": text.then((value) => new Blob([value], { type: "text/plain" })) }),
        ]);
      } else {
        await navigator.clipboard.writeText(await text);
      }
      setState("done");
      window.setTimeout(() => setState("idle"), 2500);
    } catch {
      setState("failed");
    }
  }

  const Icon = state === "done" ? ClipboardCheck : Clipboard;
  return (
    <button type="button" className={secondaryButton} onClick={copy} disabled={state === "busy"}>
      <Icon size={16} aria-hidden />
      {state === "busy"
        ? t("copying")
        : state === "done"
          ? t("copied")
          : state === "failed"
            ? t("copyFailed")
            : (label ?? t("copyForClaude"))}
    </button>
  );
}
