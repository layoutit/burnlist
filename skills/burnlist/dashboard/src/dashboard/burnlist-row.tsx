import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { burnlistHref, formatTime } from "@/dashboard/lib";
import type { Burnlist, Filter } from "@/dashboard/types";

export function BurnlistRow({ entry, filter }: { entry: Burnlist; filter: Filter }) {
  const href = entry.ovenId === "checklist" ? burnlistHref(entry, filter) : entry.href;
  const copyText = `${entry.repoKey ?? entry.repo}/${entry.id} ${entry.title}`;
  const open = () => { window.location.href = href; };
  const copy = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void navigator.clipboard?.writeText(copyText);
  };

  return (
    <tr
      aria-label={`Open ${entry.repo}/${entry.id}`}
      className="burnlist-table-row"
      data-status={entry.status}
      key={`${entry.repo}/${entry.id}`}
      onClick={open}
      onKeyDown={(event) => {
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
