type ChecklistProgressValueProps = { done: number; total: number; percent: number };

export function ChecklistProgressValue({ done, total, percent }: ChecklistProgressValueProps) {
  return <><span className="pass">{done}</span><span className="separator">·</span><span className="total">{total}</span> <span className="pass">({percent}%)</span></>;
}
