import type { ProgressData, Project, SelectedBurnlist } from "@lib";
import { useOvenLiveData } from "@oven";
import { dashboardProgressSnapshotConfig, dashboardProjectsSnapshotConfig } from "./dashboard-data.mjs";

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
  return {
    projects: projectsState.data ?? [],
    progress: selected ? progressState.data : null,
    error: progressState.error || projectsState.error,
    loading: enabled && (projectsState.loading || (Boolean(selected) && progressState.loading)),
    stale: projectsState.stale || (Boolean(selected) && progressState.stale),
  };
}
