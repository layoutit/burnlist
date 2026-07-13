import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { BurnlistRow } from "@/dashboard/burnlist-row";
import type { Filter, Project } from "@/dashboard/types";

function BurnlistTable({ entries, filter, emptyLabel }: { entries: Project["entries"]; filter: Filter; emptyLabel: string }) {
  return (
    <div className="burnlist-table-card">
      <div className="burnlist-table-scroll">
        <table className="burnlist-table">
          <colgroup>
            <col className="burnlist-table-column-primary" />
            <col className="burnlist-table-column-oven" />
            <col className="burnlist-table-column-status" />
            <col className="burnlist-table-column-progress" />
            <col className="burnlist-table-column-updated" />
          </colgroup>
          <thead className="burnlist-table-head">
            <tr>
              <th className="burnlist-table-heading">Burnlist</th>
              <th className="burnlist-table-heading">Oven</th>
              <th className="burnlist-table-heading">Lifecycle</th>
              <th className="burnlist-table-heading">Progress</th>
              <th className="burnlist-table-heading">Updated</th>
            </tr>
          </thead>
          <tbody className="burnlist-table-body">
            {entries.length ? entries.map((entry) => <BurnlistRow entry={entry} filter={filter} key={`${entry.repo}/${entry.id}`} />) : (
              <tr className="burnlist-table-row">
                <td className="burnlist-table-cell burnlist-table-cell-primary" colSpan={5}>
                  <p className="burnlist-table-title">{emptyLabel}</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProjectGroup({ project, filter }: { project: Project; filter: Filter }) {
  // Uncontrolled-with-state: initial open when the project has active work, and the user's
  // toggle survives the 5s poll re-render (a bare `open` prop would fight the poll).
  const [open, setOpen] = useState(project.counts.active > 0);
  const entries = project.entries.filter((entry) => filter === "all" || entry.status === filter);
  const badge = `${project.registered ? "registered" : "observed"} · ${project.health}`;
  const emptyLabel = project.counts.total === 0
    ? "no burnlists yet — run `burnlist new` here"
    : "no burnlists match this lifecycle view";
  return (
    <details className="dashboard-project-group" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="dashboard-project-summary">
        <span className="dashboard-project-name">{project.displayName}</span>
        <span className="dashboard-project-root">{project.canonicalRoot}</span>
        <span className="dashboard-project-counts">{project.counts.total} lists · {project.counts.active} active</span>
        <Badge className="dashboard-project-badge" variant="ghost">{badge}</Badge>
      </summary>
      <BurnlistTable emptyLabel={emptyLabel} entries={entries} filter={filter} />
    </details>
  );
}
