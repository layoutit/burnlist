import { useEffect, useState } from "react";
import type { ProgressData, Project, SelectedBurnlist } from "@/dashboard/types";

type DashboardData = {
  projects: Project[];
  progress: ProgressData | null;
  error: string;
  loading: boolean;
};

export function useDashboardData({ section, selected }: { section: string; selected: SelectedBurnlist | null }): DashboardData {
  const [projects, setProjects] = useState<Project[]>([]);
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (section !== "burnlists") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const projectsResponse = await fetch("/api/projects", { cache: "no-store" });
        if (!projectsResponse.ok) throw new Error("Could not load Burnlists.");
        const projectsData = await projectsResponse.json();
        if (cancelled) return;
        setProjects(projectsData.projects ?? []);
        if (selected) {
          const params = new URLSearchParams(selected);
          const progressResponse = await fetch(`/api/progress?${params}`, { cache: "no-store" });
          if (!progressResponse.ok) throw new Error((await progressResponse.json()).error ?? "Could not load progress.");
          if (!cancelled) setProgress(await progressResponse.json());
        } else if (!cancelled) {
          setProgress(null);
        }
        if (!cancelled) setError("");
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load dashboard data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [section, selected]);

  return { projects, progress, error, loading };
}
