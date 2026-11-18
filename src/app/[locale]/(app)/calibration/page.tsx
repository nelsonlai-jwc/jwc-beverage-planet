import { setRequestLocale } from "next-intl/server";
import { EspressoCalibrationPage } from "@/components/calibration/EspressoCalibrationPage";

export default async function CalibrationPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ outlet?: string; date?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <EspressoCalibrationPage purpose="DAILY" searchParams={await searchParams} />;
}
