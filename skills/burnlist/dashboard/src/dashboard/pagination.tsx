import { Button } from "@/components/ui/button";

const PAGE_SIZE = 20;

export function Pagination({ page, totalItems, totalPages, onPageChange }: { page: number; totalItems: number; totalPages: number; onPageChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  const firstItem = (page - 1) * PAGE_SIZE + 1;
  const lastItem = Math.min(page * PAGE_SIZE, totalItems);
  return (
    <nav aria-label="Burnlist table pages" className="dashboard-pagination">
      <p className="dashboard-pagination-summary">Showing {firstItem}–{lastItem} of {totalItems}</p>
      <div className="dashboard-pagination-controls">
        <Button aria-label="Previous page" className="dashboard-pagination-button" disabled={page === 1} onClick={() => onPageChange(page - 1)} size="sm" variant="outline">Previous</Button>
        <span aria-live="polite" className="dashboard-pagination-status">Page {page} of {totalPages}</span>
        <Button aria-label="Next page" className="dashboard-pagination-button" disabled={page === totalPages} onClick={() => onPageChange(page + 1)} size="sm" variant="outline">Next</Button>
      </div>
    </nav>
  );
}
