import type {
  DetailItem,
  OvenDataSnapshot,
  OvenSummary,
  ProgressSnapshot,
  VisualParityPayload,
} from "./types";

export function visualParityPayload(data: OvenDataSnapshot | null): VisualParityPayload | null {
  const value = data?.payload;
  if (!value || typeof value !== "object" || (value as { schema?: unknown }).schema !== "burnlist-visual-parity-data@1") return null;
  const root = value as Record<string, unknown>, record = (entry: unknown) => entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : {}, text = (entry: unknown, fallback = "—") => typeof entry === "string" ? entry : fallback, number = (entry: unknown) => typeof entry === "number" && Number.isFinite(entry) ? entry : 0;
  const image = (entry: unknown) => { const source = record(entry); return { label: text(source.label), src: typeof source.src === "string" ? source.src : null, width: number(source.width), height: number(source.height) }; };
  const domains = (Array.isArray(root.domains) ? root.domains : []).map((entry) => { const source = record(entry), tolerance = record(source.tolerance); return { id: text(source.id), label: text(source.label), isolation: "render-pass" as const, qualification: source.qualification === "target" ? "target" as const : "context" as const, ...(Object.keys(tolerance).length ? { tolerance: { rationale: typeof tolerance.rationale === "string" ? tolerance.rationale : undefined, channelDelta: number(tolerance.channelDelta), meanAbsoluteDelta: number(tolerance.meanAbsoluteDelta), changedPixelRatio: number(tolerance.changedPixelRatio) } } : {}) }; });
  const comparisons = (Array.isArray(root.comparisons) ? root.comparisons : []).map((entry) => { const source = record(entry), rawDomains = record(source.domains), mapped = Object.fromEntries(Object.entries(rawDomains).map(([id, domain]) => { const item = record(domain), difference = record(item.difference); return [id, { label: text(item.label), status: item.status === "pass" ? "pass" as const : "fail" as const, reference: image(item.reference), candidate: image(item.candidate), diff: image(item.diff), difference: { changedPixels: number(difference.changedPixels), totalPixels: number(difference.totalPixels), ratio: number(difference.ratio), meanAbsoluteDelta: number(difference.meanAbsoluteDelta), maximumAbsoluteDelta: number(difference.maximumAbsoluteDelta) } }]; })); return { id: text(source.id), label: text(source.label), frame: number(source.frame), status: source.status === "pass" ? "pass" as const : "fail" as const, domains: mapped }; });
  return { schema: "burnlist-visual-parity-data@1", differentialTesting: { publishedAt: null, scenarioCatalog: { selectedScenarioId: "", scenarios: [] } }, domains, comparisons };
}

function checklistItems(progress: ProgressSnapshot): DetailItem[] {
  const root = progress as unknown as Record<string, unknown>;
  const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const text = (value: unknown) => typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
  const fields = (value: unknown) => Object.fromEntries(Object.entries(record(value)).map(([key, entry]) => [text(key), text(entry)]).filter(([key]) => key));
  const active = Array.isArray(root.active) ? root.active.map(record) : [];
  const completed = (Array.isArray(root.completed) ? root.completed.map(record) : []).sort((left, right) => {
    const delta = Date.parse(text(right.completedAt)) - Date.parse(text(left.completedAt));
    return Number.isFinite(delta) ? delta : 0;
  });
  return [
    ...active.map((item, index) => ({
      key: `active:${text(item.id) || index}`,
      kind: "active" as const,
      id: text(item.id),
      title: text(item.title),
      status: "ACTIVE",
      latest: false,
      fields: fields(item.fields),
    })),
    ...completed.map((item, index) => ({
      key: `completed:${text(item.id) || index}`,
      kind: "completed" as const,
      id: text(item.id),
      title: text(item.title),
      status: "DONE",
      latest: index === 0,
      completedAt: text(item.completedAt),
      detail: text(item.detail),
    })),
  ];
}

export function detailItems(
  oven: OvenSummary | null,
  progress: ProgressSnapshot | null,
  _data: OvenDataSnapshot | null,
): DetailItem[] {
  if (oven?.contract === "checklist-progress@1" && progress) return checklistItems(progress);
  return [];
}
