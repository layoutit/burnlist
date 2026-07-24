import { useEffect, useMemo } from "react";
import type { ResolvedOvenIr } from "@hooks";
import type { ChecklistProgressData } from "@lib";
import { adaptChecklist } from "@lib/checklist-adapter";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";
import "./ChecklistDashboard.css";

export function ChecklistOvenView({ data, ir }: { data: ChecklistProgressData; ir: ResolvedOvenIr }) {
  const payload = useMemo(() => adaptChecklist(data), [data]);
  useEffect(() => {
    document.body.classList.add("driving-parity-view", "checklist-detail-view");
    return () => document.body.classList.remove("driving-parity-view", "checklist-detail-view");
  }, []);
  return <OvenRuntime ir={ir} payload={payload} />;
}
