import type { ChecklistProgressData } from "@lib";
import { ProgressLedger } from "@/components/ChecklistDashboard/ChecklistDashboard";

export function ChecklistLedger({ data }: { data: ChecklistProgressData }) {
  return <ProgressLedger data={data} />;
}
