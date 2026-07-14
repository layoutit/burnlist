import { useRef, useState } from "react";
import { Badge } from "@layout";
import { projectGroupOpen, projectGroupShouldResetOpen } from "@lib/project-open";
import type { Filter, Project } from "@lib";
import { BurnlistTable } from "./BurnlistTable";

export function ProjectGroup({ project, filter }: { project: Project; filter: Filter }) {
  // Uncontrolled-with-state: initial open when the current filter has rows, and the user's
  // toggle survives the 5s poll re-render (a bare `open` prop would fight the poll).
  const filteredEntries = project.entries.filter((entry) => filter === "all" || entry.status === filter);
  const derivedOpen = projectGroupOpen(filteredEntries, project.counts.total);
  const [open, setOpen] = useState(() => derivedOpen);
  const previousFilter = useRef(filter);
  if (projectGroupShouldResetOpen(previousFilter.current, filter)) {
    previousFilter.current = filter;
    setOpen(derivedOpen);
  }
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
      <BurnlistTable ambiguousIds={project.ambiguousIds} emptyLabel={emptyLabel} entries={filteredEntries} filter={filter} />
    </details>
  );
}
