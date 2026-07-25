type ChecklistEvent = Readonly<{ id: string; title: string; completedAt: string; detail: string }>;
type ChecklistRaw = Readonly<{ generatedAt: string; total: number; done: number; remaining: number; percent: number; active: readonly Readonly<{ id: string; title: string }>[]; completed: readonly ChecklistEvent[] }>;

const base = { generatedAt: "2026-07-24T12:00:00Z", total: 6, done: 2, remaining: 4, percent: 33 };
const event = (id: string, title: string): ChecklistEvent => ({ id, title, completedAt: "2026-07-24T11:00:00Z", detail: `Outcome: ${title}` });
const payload = (raw: ChecklistRaw) => ({ current: raw.active.length ? { title: raw.active[0]!.title, value: `${raw.active[0]!.id} · Active` } : { title: "No active task", value: "Complete" }, progress: { title: "Checklist", done: raw.done, total: raw.total, percent: raw.percent }, durations: { elapsed: "12m", pace: "2m", timeLeft: "8m" }, raw });
const active = { ...base, active: [{ id: "B14", title: "Render Checklist composite" }], completed: [event("B12", "Shared foundations"), event("B13", "Differential primitives")] };
const completed = { ...base, done: 6, remaining: 0, percent: 100, active: [], completed: Array.from({ length: 6 }, (_, index) => event(`B${index + 1}`, `Checklist complete ${index + 1}`)) };
const long = { generatedAt: base.generatedAt, total: 32, done: 28, remaining: 4, percent: 88, active: [{ id: "B29", title: "Render Checklist composite" }], completed: Array.from({ length: 28 }, (_, index) => event(`B${index + 1}`, `Completed checklist event ${index + 1}`)) };
export const checklistFixture = { id: "checklist", checkpoints: ["active", "completed", "long-list", "detail"] as const, active: payload(active), completed: payload(completed), longList: payload(long) } as const;
