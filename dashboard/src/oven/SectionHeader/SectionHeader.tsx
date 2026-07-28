type SectionHeaderProps = {
  title: string;
  count?: number;
  className?: string;
  children?: import("react").ReactNode;
};

export function SectionHeader({ title, count, className, children }: SectionHeaderProps) {
  if (children != null) return <h2 className={className}>{`${title} `}{children}</h2>;
  if (count !== undefined) return <h2 className={className}>{`${title} `}<span className="field-list-count">({count})</span></h2>;
  return <h2 className={className}>{title}</h2>;
}
