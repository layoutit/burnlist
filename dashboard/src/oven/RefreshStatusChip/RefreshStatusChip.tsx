export type RefreshStatus = {
  status?: string;
  error?: string;
};

export type RefreshStatusChipProps = {
  refresh?: RefreshStatus;
  clientStatus?: string | null;
};

export function differentialRefreshStatusLabel(refresh?: RefreshStatus, clientStatus?: string | null): string {
  if (clientStatus === "loading") return "Loading";
  if (clientStatus === "queued") return "Queued";
  if (clientStatus === "running") return "Updating";
  if (clientStatus === "failed") return "Update failed";
  if (refresh?.status === "queued") return "Queued";
  if (refresh?.status === "running") return "Updating";
  if (refresh?.status === "failed") return "Update failed";
  return "";
}

export function RefreshStatusChip({ refresh, clientStatus = null }: RefreshStatusChipProps) {
  const label = differentialRefreshStatusLabel(refresh, clientStatus);
  const statusClass = clientStatus || refresh?.status || "";
  const statusTitle = refresh?.status === "failed" ? refresh.error || label : label;

  return <span
    id="differential-refresh-status"
    className={`differential-refresh-status ${statusClass}`}
    title={statusTitle}
    hidden={!label}
  >{label}</span>;
}
