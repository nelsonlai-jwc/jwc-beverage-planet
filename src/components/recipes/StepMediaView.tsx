import { useTranslations } from "next-intl";
import type { StepMedia } from "@/lib/recipes/types";

// A step's photo (tap to open full size) or video (plays only when tapped).
export function StepMediaView({ media, stepNo }: { media: StepMedia; stepNo: number }) {
  const t = useTranslations("Recipes");
  if (!media.url) {
    return <div className="aspect-video w-full max-w-sm rounded-[10px] bg-[#eceee8]" />;
  }
  if (media.isVideo) {
    return (
      <video
        // #t=0.1 makes iPhones show the first frame instead of a blank box.
        src={`${media.url}#t=0.1`}
        controls
        playsInline
        preload="metadata"
        aria-label={t("stepMediaAlt", { no: stepNo })}
        className="aspect-video w-full max-w-sm rounded-[10px] bg-black"
      />
    );
  }
  return (
    <a href={media.url} target="_blank" rel="noopener noreferrer" className="block w-full max-w-sm">
      {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs */}
      <img src={media.url} alt={t("stepMediaAlt", { no: stepNo })} className="aspect-video w-full rounded-[10px] object-cover" />
    </a>
  );
}
