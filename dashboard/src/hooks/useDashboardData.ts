import { useEffect, useRef, useState } from "react";
import type { ProgressData, Project, SelectedBurnlist } from "@lib";

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
  const inFlight = useRef(false);
  const refreshSequence = useRef(0);

  useEffect(() => {
    if (section !== "burnlists") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      const sequence = ++refreshSequence.current;
      const current = () => !cancelled && sequence === refreshSequence.current;
      try {
        const projectsResponse = await fetch("/api/projects", { cache: "no-store" });
        if (!projectsResponse.ok) throw new Error("Could not load Burnlists.");
        const projectsData = await projectsResponse.json();
        if (!current()) return;
        setProjects(projectsData.projects ?? []);
        if (selected) {
          const params = new URLSearchParams(selected);
          const progressResponse = await fetch(`/api/progress?${params}`, { cache: "no-store" });
          if (!progressResponse.ok) throw new Error((await progressResponse.json()).error ?? "Could not load progress.");
          if (current()) setProgress(await progressResponse.json());
        } else if (current()) {
          setProgress(null);
        }
        if (current()) setError("");
      } catch (cause) {
        if (current()) setError(cause instanceof Error ? cause.message : "Could not load dashboard data.");
      } finally {
        inFlight.current = false;
        if (current()) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      refreshSequence.current += 1;
      window.clearInterval(timer);
    };
  }, [section, selected]);

  return { projects, progress, error, loading };
}
