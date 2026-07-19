import type { ChecklistProgressData } from "@lib";
import { ProgressPanel } from "@/components/ChecklistDashboard/ChecklistDashboard";

export function ChecklistBurnPanel({ data }: { data: ChecklistProgressData }) {
  return <ProgressPanel data={data} />;
}
