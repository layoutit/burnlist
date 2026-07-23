import type {
  DetailItem,
  OvenDataSnapshot,
  OvenSummary,
  ProgressSnapshot,
  VisualParityPayload,
} from "./types";

export function visualParityPayload(data: OvenDataSnapshot | null): VisualParityPayload | null {
  const value = data?.payload;
  return value && typeof value === "object"
    && (value as { schema?: string }).schema === "burnlist-visual-parity-data@1"
    ? value as VisualParityPayload
    : null;
}

function checklistItems(progress: ProgressSnapshot): DetailItem[] {
  const completed = [...progress.completed].sort((left, right) => {
    const delta = Date.parse(right.completedAt) - Date.parse(left.completedAt);
    return Number.isFinite(delta) ? delta : 0;
  });
  const newest = completed[0]?.id ?? null;
  return [
    ...progress.active.map((item) => ({
      key: `active:${item.id}`,
      kind: "active" as const,
      id: item.id,
      title: item.title,
      status: "ACTIVE",
      latest: false,
      fields: item.fields,
    })),
    ...completed.map((item) => ({
      key: `completed:${item.id}`,
      kind: "completed" as const,
      id: item.id,
      title: item.title,
      status: "DONE",
      latest: item.id === newest,
      completedAt: item.completedAt,
      detail: item.detail,
    })),
  ];
}

function visualItems(payload: VisualParityPayload): DetailItem[] {
  const last = payload.comparisons.length - 1;
  return payload.comparisons.map((comparison, comparisonIndex) => ({
    key: `frame:${comparison.id}`,
    kind: "visual-frame" as const,
    id: `frame ${comparison.frame}`,
    title: comparison.label,
    status: comparison.status.toUpperCase(),
    latest: comparisonIndex === last,
    comparisonIndex,
  }));
}

export function detailItems(
  oven: OvenSummary | null,
  progress: ProgressSnapshot | null,
  data: OvenDataSnapshot | null,
): DetailItem[] {
  if (oven?.contract === "checklist-progress@1" && progress) return checklistItems(progress);
  const payload = visualParityPayload(data);
  if (oven?.id === "visual-parity" && payload) return visualItems(payload);
  return [];
}
