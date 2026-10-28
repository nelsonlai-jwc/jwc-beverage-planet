import { ThreeDPaperBackground } from "@/components/login/ThreeDPaperBackground";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const localeLabels: Record<string, string> = {
  en: "EN",
  "zh-CN": "简体中文",
};

// Layout of the signed-out pages: paper background, language switch, form.
export function AuthLayout({
  locale,
  path,
  children,
}: {
  locale: string;
  path: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-wrap bg-[#c7c9c2] text-black">
      <section
        aria-label="JWC Beverage Planet"
        className="h-[300px] flex-[1_1_100%] md:h-auto md:min-h-dvh md:flex-[1_1_560px]"
      >
        <ThreeDPaperBackground />
      </section>
      <main className="flex flex-[1_1_480px] flex-col gap-6 px-5 py-6 md:px-12 md:py-8">
        <nav aria-label="Language" className="flex justify-end gap-1">
          {routing.locales.map((code) => (
            <Link
              key={code}
              href={path}
              locale={code}
              aria-current={code === locale ? "true" : undefined}
              className={
                code === locale
                  ? "rounded-full bg-black px-3.5 py-2 text-sm font-semibold text-white"
                  : "rounded-full px-3.5 py-2 text-sm"
              }
            >
              {localeLabels[code]}
            </Link>
          ))}
        </nav>
        <div className="flex flex-1 items-start justify-center md:items-center">{children}</div>
      </main>
    </div>
  );
}
