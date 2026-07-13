import type { MouseEvent } from "react";
import { Button, Progress } from "@layout";
import { burnlistHref, formatTime } from "@lib";
import type { Burnlist, Filter } from "@lib";

export function BurnlistRow({ entry, filter, ambiguous }: { entry: Burnlist; filter: Filter; ambiguous: boolean }) {
  const href = entry.ovenId === "checklist" ? burnlistHref(entry, filter, ambiguous) : entry.href;
  const open = () => { window.location.href = href; };
  const copy = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const url = window.location.origin + (entry.ovenId === "checklist" && ambiguous
      ? href
      : entry.ovenId === "checklist"
      ? (entry.repoKey ? `/r/${encodeURIComponent(entry.repoKey)}/${encodeURIComponent(entry.id)}` : `/${encodeURIComponent(entry.repo)}/${encodeURIComponent(entry.id)}`)
      : entry.href);
    void navigator.clipboard?.writeText(url);
  };

  return (
    <tr
      aria-label={`Open ${entry.repo}/${entry.id}`}
      className="burnlist-table-row"
      data-status={entry.status}
      key={`${entry.repoKey ?? entry.repo}/${entry.status}/${entry.id}/${entry.planLabel}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      role="link"
      tabIndex={0}
    >
      <td className="burnlist-table-cell burnlist-table-cell-primary">
        <p className="burnlist-table-repo">{entry.repo}/{entry.id}</p>
        <p className="burnlist-table-title">{entry.title}</p>
        <Button aria-label={`Copy ${entry.repoKey ?? entry.repo}/${entry.id} and title`} className="burnlist-copy-button" onClick={copy} size="xs" type="button" variant="ghost">Copy</Button>
      </td>
      <td className="burnlist-table-cell burnlist-table-cell-oven">{entry.ovenName}</td>
      <td className="burnlist-table-cell burnlist-table-cell-status" data-status={entry.status}>{entry.statusLabel}</td>
      <td className="burnlist-table-cell burnlist-table-cell-progress">
        <div className="burnlist-table-progress-meta"><span>{entry.progressLabel}</span>{entry.percent != null && <span>{entry.percent}%</span>}</div>
        {entry.percent != null && <Progress className="burnlist-table-progress" value={entry.percent} />}
      </td>
      <td className="burnlist-table-cell burnlist-table-cell-updated timestamp">{formatTime(entry.updatedAt)}</td>
    </tr>
  );
}
