import { useEffect, useMemo } from "react";
import type { ChecklistProgressData } from "@lib";
import { adaptChecklist } from "@lib/checklist-adapter";
import { OvenRuntime } from "@/oven/runtime/OvenRuntime";
import ovenIr from "../../../../ovens/checklist/checklist.ir.json";
import "./ChecklistDashboard.css";

export function ChecklistOvenView({ data }: { data: ChecklistProgressData }) {
  const payload = useMemo(() => adaptChecklist(data), [data]);
  useEffect(() => {
    document.body.classList.add("driving-parity-view", "checklist-detail-view");
    return () => document.body.classList.remove("driving-parity-view", "checklist-detail-view");
  }, []);
  return <OvenRuntime ir={ovenIr} payload={payload} />;
}
