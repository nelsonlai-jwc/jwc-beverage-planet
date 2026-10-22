const tones = {
  green: "bg-brand-green text-black",
  purple: "bg-brand-purple text-white",
  orange: "bg-brand-orange text-black",
  red: "bg-brand-red text-black",
  grey: "bg-[#eceee8] text-black",
} as const;

export function StatusBadge({
  tone,
  children,
}: {
  tone: keyof typeof tones;
  children: React.ReactNode;
}) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}
