import type { ChangeEvent } from "react";

export type PaginationBarProps = {
  pageSize: number;
  pageIndex: number;
  pageCount: number;
  start: number;
  end: number;
  total: number;
  onPageSizeChange?: (size: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
};

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

export function PaginationBar({
  pageSize,
  pageIndex,
  pageCount,
  start,
  end,
  total,
  onPageSizeChange,
  onPrev,
  onNext,
}: PaginationBarProps) {
  const hidden = total <= pageSize;
  const prevDisabled = pageIndex === 0;
  const nextDisabled = pageIndex >= pageCount - 1;

  function handlePageSizeChange(event: ChangeEvent<HTMLSelectElement>) {
    onPageSizeChange?.(Number(event.currentTarget.value));
  }

  return <div
    id="driving-parity-pagination"
    className="driving-parity-controls driving-parity-pagination"
    hidden={hidden}
  >
    <select
      id="driving-parity-page-size"
      aria-label="Differential Testing rows per page"
      defaultValue={String(pageSize)}
      onChange={handlePageSizeChange}
    >
      {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
    </select>
    <button
      type="button"
      id="driving-parity-page-prev"
      aria-label="Differential Testing previous page"
      disabled={prevDisabled}
      onClick={onPrev}
    >Prev</button>
    <span className="page-status" id="driving-parity-page-status">{`${start}-${end} / ${total}`}</span>
    <button
      type="button"
      id="driving-parity-page-next"
      aria-label="Differential Testing next page"
      disabled={nextDisabled}
      onClick={onNext}
    >Next</button>
  </div>;
}
