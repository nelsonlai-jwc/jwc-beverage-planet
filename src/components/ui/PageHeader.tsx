export function PageHeader({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="font-serif text-[32px] font-normal">{title}</h1>
      {note && <p className="text-sm text-[#3d3f3a]">{note}</p>}
    </div>
  );
}
