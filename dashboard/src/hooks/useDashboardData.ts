import type { ProgressData, Project, SelectedBurnlist } from "@lib";
import { useOvenLiveData } from "@oven";
import { dashboardLoopProjectionSnapshotConfig, dashboardProgressSnapshotConfig, dashboardProjectsSnapshotConfig } from "./dashboard-data.mjs";

type DashboardData = {
  projects: Project[];
  progress: ProgressData | null;
  error: string;
  loading: boolean;
  stale: boolean;
};

export function useDashboardData({ section, selected }: { section: string; selected: SelectedBurnlist | null }): DashboardData {
  const enabled = section === "burnlists";
  const projectsState = useOvenLiveData<Project[]>(dashboardProjectsSnapshotConfig(enabled));
  const progressState = useOvenLiveData<ProgressData>(dashboardProgressSnapshotConfig(enabled, selected));
  const loopState = useOvenLiveData<ProgressData["loopRun"]>(dashboardLoopProjectionSnapshotConfig(enabled, selected));
  const loopDiagnostic = loopState.error.includes("retaining the last verified projection") ? "corrupt"
    : loopState.stale || loopState.error ? "stale" : undefined;
  const loopRun = loopState.data && loopDiagnostic ? { ...loopState.data, diagnostic: loopDiagnostic } : loopState.data;
  return {
    projects: projectsState.data ?? [],
    progress: selected && progressState.data ? {
      ...progressState.data,
      loopRun,
      ...(loopDiagnostic ? { loopProjectionDiagnostic: loopDiagnostic, loopProjectionMessage: loopState.error || undefined } : {}),
    } : null,
    error: loopState.error || progressState.error || projectsState.error,
    loading: enabled && (projectsState.loading || (Boolean(selected) && (progressState.loading || loopState.loading))),
    stale: projectsState.stale || (Boolean(selected) && (progressState.stale || loopState.stale)),
  };
}
