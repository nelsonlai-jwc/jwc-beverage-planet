import { setRequestLocale } from "next-intl/server";
import { FilterCalibrationPage } from "@/components/calibration/filter/FilterCalibrationPage";

export default async function FilterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ outlet?: string; date?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <FilterCalibrationPage purpose="DAILY" searchParams={await searchParams} />;
}
