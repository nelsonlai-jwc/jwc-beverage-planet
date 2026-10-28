import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { applyOptionLabels, getOptionLabels } from "@/lib/settings/options";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  const messages = (await import(`../../messages/${locale}.json`)).default;
  // Style, temperature and strength names can be renamed by the Admin (Settings).
  return {
    locale,
    messages: applyOptionLabels(messages, await getOptionLabels(), locale),
  };
});
