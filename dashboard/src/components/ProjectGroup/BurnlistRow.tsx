import type { KeyboardEvent } from "react";
import { Badge } from "@layout";
import { burnlistHref, formatListTime, formatTime } from "@lib";
import type { Burnlist, Filter } from "@lib";

export function BurnlistRow({ entry, filter, ambiguous, projectLabel, projectRowSpan }: { entry: Burnlist; filter: Filter; ambiguous: boolean; projectLabel: string | null; projectRowSpan: number }) {
  const blocked = entry.statusLabel === "Blocked";
  const progressLabel = entry.done != null ? `${entry.done} / ${entry.total}` : entry.progressLabel;
  const href = blocked ? entry.href : entry.ovenId === "checklist" ? burnlistHref(entry, filter, ambiguous) : entry.href;
  const open = () => { window.location.href = href; };

  return (
    <tr
      className="burnlist-table-row"
      data-status={entry.status}
      key={`${entry.repoKey ?? entry.repo}/${entry.status}/${entry.id}/${entry.planLabel}`}
      {...(blocked ? {} : {
        "aria-label": `Open ${entry.repo}/${entry.id}`,
        onClick: open,
        onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
        },
        role: "link",
        tabIndex: 0,
      })}
    >
      {projectLabel && <th className="burnlist-table-cell burnlist-table-cell-project" rowSpan={projectRowSpan} scope="rowgroup" title={projectLabel}>{projectLabel}</th>}
      <td className="burnlist-table-cell burnlist-table-cell-primary">
        <span className="burnlist-table-title" title={`${entry.title} · ${entry.ovenName}`}>{entry.title}</span>
        {blocked && <span className="burnlist-table-row-state"> · Blocked</span>}
        {blocked && <span className="visually-hidden" data-blocked-reason="true">{entry.blockers ?? entry.statusLabel}</span>}
      </td>
      <td className="burnlist-table-cell burnlist-table-cell-oven">
        <Badge data-oven={entry.ovenId} title={entry.ovenName} variant="outline">{entry.ovenName}</Badge>
      </td>
      {filter === "all" && <td className="burnlist-table-cell burnlist-table-cell-status">
        <span className="burnlist-table-status" data-blocked={blocked || undefined} data-status={entry.status}>{entry.statusLabel}</span>
      </td>}
      <td className="burnlist-table-cell burnlist-table-cell-progress">
        {blocked ? "—" : <><span>{progressLabel}</span>{entry.percent != null && <span className="burnlist-table-percent"> · {entry.percent}%</span>}</>}
      </td>
      <td className="burnlist-table-cell burnlist-table-cell-updated"><time className="timestamp" dateTime={entry.updatedAt ?? undefined} title={formatTime(entry.updatedAt)}>{entry.updatedAt ? formatListTime(entry.updatedAt) : "—"}</time></td>
    </tr>
  );
}
