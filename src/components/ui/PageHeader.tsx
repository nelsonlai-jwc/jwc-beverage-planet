export function PageHeader({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-2xl font-semibold leading-tight tracking-[-0.02em] md:text-[28px]">{title}</h1>
      {note && <p className="text-sm text-[#3d3f3a]">{note}</p>}
    </div>
  );
}
