type SectionHeaderProps = {
  title: string;
  count?: number;
  className?: string;
  children?: import("react").ReactNode;
};

export function SectionHeader({ title, count, className, children }: SectionHeaderProps) {
  return <h2 className={className}>{`${title} `}{children ?? <span className="field-list-count">({count})</span>}</h2>;
}
