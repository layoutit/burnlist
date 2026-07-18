import type { ReactNode } from "react";

type LogTableProps = {
  columns: string[];
  rows: { key?: string; className: string; cells: { className: string; content: ReactNode }[] }[];
  placeholderCount?: number;
  emptyState?: ReactNode;
  className?: string;
};

export function LogTable({ columns, rows, placeholderCount = 0, emptyState, className }: LogTableProps) {
  return <div className={className ?? "checklist-log-list"}>
    <div className="checklist-log-table-header">{columns.map((column, index) => <span key={index}>{column}</span>)}</div>
    {rows.map((row, index) => <article className={row.className} key={row.key ?? index}>{row.cells.map((cell, cellIndex) => <span className={cell.className} key={cellIndex}>{cell.content}</span>)}</article>)}
    {Array.from({ length: Math.max(0, placeholderCount ?? 0) }).map((_, index) => <article className="log-row no-detail log-table-row log-placeholder-row" aria-hidden="true" key={`placeholder-${index}`}>{columns.map((_, columnIndex) => <span className={columnIndex === 0 ? "log-table-cell age" : "log-table-cell"} key={columnIndex}>.</span>)}</article>)}
    {rows.length === 0 && emptyState}
  </div>;
}
