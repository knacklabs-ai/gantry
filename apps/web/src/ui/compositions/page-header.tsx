export function PageHeader({
  eyebrow,
  id,
  title,
}: {
  eyebrow: string;
  id: string;
  title: string;
}) {
  return (
    <header>
      <span className="font-mono text-[10px] font-semibold tracking-[0.08em] text-text-muted uppercase">
        {eyebrow}
      </span>
      <h1 className="mt-2 mb-0 text-[26px] leading-[1.2] font-semibold" id={id}>
        {title}
      </h1>
    </header>
  );
}
