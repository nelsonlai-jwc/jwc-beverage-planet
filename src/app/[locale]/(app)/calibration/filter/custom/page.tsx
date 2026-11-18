import { setRequestLocale } from "next-intl/server";
import { FilterCalibrationPage } from "@/components/calibration/filter/FilterCalibrationPage";

export default async function CustomFilterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ outlet?: string; date?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <FilterCalibrationPage purpose="CUSTOM" searchParams={await searchParams} />;
}
