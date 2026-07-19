import type { ChecklistProgressData } from "@lib";
import { EventCardList } from "@/components/ChecklistDashboard/ChecklistDashboard";

export function ChecklistEventCards({ data }: { data: ChecklistProgressData }) {
  return <EventCardList data={data} />;
}
