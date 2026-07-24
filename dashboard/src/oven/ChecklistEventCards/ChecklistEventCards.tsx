import type { ChecklistProgressData } from "@lib";
import { ChecklistWorkspace } from "../ChecklistWorkspace";

export function ChecklistEventCards({ data }: { data: ChecklistProgressData }) {
  return <ChecklistWorkspace data={data} />;
}
