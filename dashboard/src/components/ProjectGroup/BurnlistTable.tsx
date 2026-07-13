import { BurnlistRow } from "./BurnlistRow";
import type { Filter, Project } from "@lib";

export function BurnlistTable({ entries, filter, emptyLabel, ambiguousIds }: { entries: Project["entries"]; filter: Filter; emptyLabel: string; ambiguousIds: string[] }) {
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
            {entries.length ? entries.map((entry) => <BurnlistRow ambiguous={ambiguousIds.includes(entry.id)} entry={entry} filter={filter} key={`${entry.repoKey ?? entry.repo}/${entry.status}/${entry.id}/${entry.planLabel}`} />) : (
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
