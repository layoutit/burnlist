import type { ReactNode } from "react";

export function BurnlistTable({ children, showStatus }: { children: ReactNode; showStatus: boolean }) {
  return (
    <div className="burnlist-table-card">
      <div className="burnlist-table-scroll">
        <table aria-label="Burnlists" className="burnlist-table" data-show-status={showStatus}>
          <colgroup>
            <col className="burnlist-table-column-project" />
            <col className="burnlist-table-column-primary" />
            <col className="burnlist-table-column-oven" />
            {showStatus && <col className="burnlist-table-column-status" />}
            <col className="burnlist-table-column-progress" />
            <col className="burnlist-table-column-updated" />
          </colgroup>
          <thead className="burnlist-table-head">
            <tr>
              <th className="burnlist-table-heading burnlist-table-heading-project">Project</th>
              <th className="burnlist-table-heading burnlist-table-heading-primary">Burnlist</th>
              <th className="burnlist-table-heading burnlist-table-heading-oven">Oven</th>
              {showStatus && <th className="burnlist-table-heading burnlist-table-heading-status">Status</th>}
              <th className="burnlist-table-heading burnlist-table-heading-progress">Progress</th>
              <th className="burnlist-table-heading burnlist-table-heading-updated">Updated</th>
            </tr>
          </thead>
          {children}
        </table>
      </div>
    </div>
  );
}
