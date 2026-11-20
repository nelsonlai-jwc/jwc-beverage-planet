import { redirect } from "next/navigation";

/** Old Calibration page: everything is on /calibration now. */
export default async function OldCalibrationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/calibration`);
}
