import { useEffect, useRef } from "react";
import { definitionChangeInvalidates } from "./oven-runtime/definition-adapter";
import { eventInvalidatesScope, observeDashboardEvents, type OvenEvent, type StreamStatus } from "./event-stream";
import type { BurnlistSummary, OvenPackageDetail, OvenSummary } from "./types";

export function useDashboardRefresh({
  base,
  loadLanding,
  refreshActive,
  setStreamStatus,
  activeOven,
  selectedBurnlist,
  ovenDetail,
}: {
  base: string;
  loadLanding(): Promise<void>;
  refreshActive(): void;
  setStreamStatus(status: StreamStatus): void;
  activeOven: OvenSummary | null;
  selectedBurnlist: BurnlistSummary | null;
  ovenDetail: OvenPackageDetail | null;
}) {
  const refreshActiveRef = useRef(refreshActive);
  const activeDefinitionRef = useRef<{ ovenId: string; repoKey: string | null; definitionRepoKey: string | null; subjectId: string | null } | null>(null);
  useEffect(() => { refreshActiveRef.current = refreshActive; }, [refreshActive]);
  useEffect(() => {
    activeDefinitionRef.current = activeOven ? {
      ovenId: activeOven.id,
      repoKey: selectedBurnlist?.repoKey ?? activeOven.repoKey,
      definitionRepoKey: ovenDetail?.repoKey ?? activeOven.repoKey,
      subjectId: selectedBurnlist?.id ?? null,
    } : null;
  }, [activeOven, ovenDetail?.repoKey, selectedBurnlist?.id, selectedBurnlist?.repoKey]);
  useEffect(() => observeDashboardEvents(base, {
    onInvalidate: (event?: OvenEvent) => {
      void loadLanding();
      let matches = eventInvalidatesScope(event, activeDefinitionRef.current);
      if (event?.kind === "definition-changed") {
        const active = activeDefinitionRef.current;
        matches = !!active && definitionChangeInvalidates(active, event);
      }
      if (matches) refreshActiveRef.current();
    },
    onStatus: (status) => {
      setStreamStatus(status);
      if (status === "live") refreshActiveRef.current();
    },
  }), [base, loadLanding, setStreamStatus]);
  useEffect(() => {
    const timer = setInterval(() => void loadLanding(), 30_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }, [loadLanding]);
}
