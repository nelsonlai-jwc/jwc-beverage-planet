export function PageHeader({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="font-serif text-[26px] font-normal leading-tight md:text-[28px]">{title}</h1>
      {note && <p className="text-sm text-[#3d3f3a]">{note}</p>}
    </div>
  );
}
