import { useTranslations } from "next-intl";
import { JwcSpinner3D } from "./JwcSpinner3D";

const block = "rounded-full bg-black/[0.07] animate-pulse";

/** Shown while a page loads: grey placeholders in the page's shape, with the turning 3D JWC. */
export function PageSkeleton() {
  const t = useTranslations("Shell");
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">{t("loading")}</span>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2.5">
          <div className={`${block} h-7 w-48 md:h-8`} />
          <div className={`${block} h-4 w-72 max-w-full`} />
        </div>
        <div className="flex gap-2">
          <div className={`${block} h-9 w-24`} />
          <div className={`${block} h-9 w-32`} />
        </div>
      </div>
      <div className="flex gap-2">
        <div className={`${block} h-8 w-20`} />
        <div className={`${block} h-8 w-24`} />
        <div className={`${block} h-8 w-28`} />
      </div>
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center justify-between gap-4 rounded-[20px] bg-white/60 p-5">
            <div className="flex flex-1 flex-col gap-2.5">
              <div className={`${block} h-4 w-1/3`} />
              <div className={`${block} h-3 w-1/2`} />
            </div>
            <div className={`${block} h-8 w-20`} />
          </div>
        ))}
      </div>
      {/* Centred on the whole screen, not just the content area. */}
      <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center">
        <JwcSpinner3D className="h-14 w-36 md:h-16 md:w-40" />
      </div>
    </div>
  );
}
