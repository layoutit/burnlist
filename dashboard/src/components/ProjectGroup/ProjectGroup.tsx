import type { Filter, Project } from "@lib";
import { BurnlistRow } from "./BurnlistRow";

export function ProjectGroup({ project, filter }: { project: Project; filter: Filter }) {
  const filteredEntries = project.entries.filter((entry) => filter === "all" || entry.status === filter);
  if (!filteredEntries.length) return null;
  return (
    <tbody className="dashboard-project-group">
      {filteredEntries.map((entry, index) => <BurnlistRow
        ambiguous={project.ambiguousIds.includes(entry.id)}
        entry={entry}
        filter={filter}
        key={`${entry.repoKey ?? entry.repo}/${entry.status}/${entry.id}/${entry.planLabel}`}
        projectLabel={index === 0 ? project.displayName : null}
        projectRowSpan={filteredEntries.length}
      />)}
    </tbody>
  );
}
