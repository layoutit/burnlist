import { inspectJsonBudget } from "./resource-budget";
import { TERMINAL_RESOURCE_LIMITS } from "./resource-limits";
import { validateTerminalOvenIR, type JsonValue, type TerminalOvenIR } from "./terminal-contract";
import type { OvenPackageDetail } from "../types";

export type OvenScope = Readonly<{ ovenId: string; repoKey: string | null }>;
export type OvenQuery = URLSearchParams | string | Readonly<Record<string, string | number | boolean | null | undefined>>;
export type OvenDefinition = Readonly<{
  scope: OvenScope;
  definitionRepoKey: string | null;
  ovenRevision: string;
  ir: TerminalOvenIR;
  detail: OvenPackageDetail;
}>;
export type OvenPage = Readonly<{ page: number; pageSize: number; pageCount: number; total: number }>;

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const scopeText = (value: unknown) => value === null || text(value);
const pageNumber = (value: unknown, minimum: number) => Number.isSafeInteger(value) && Number(value) >= minimum ? Number(value) : null;
const revision = (value: unknown): value is string => typeof value === "string" && /^o1-sha256:[a-f0-9]{64}$/u.test(value);
const safeText = (value: unknown): value is string => text(value) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u001b]/u.test(value);
const cloned = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Scope identity is deliberately `(repoKey, ovenId)`, never the Oven id alone. */
export function ovenScopeKey({ repoKey, ovenId }: OvenScope): string {
  if (!scopeText(repoKey) || !text(ovenId)) throw new Error("Oven scope requires an id and nullable repository key.");
  return JSON.stringify([repoKey, ovenId]);
}

function queryParams(query?: OvenQuery): URLSearchParams {
  if (query instanceof URLSearchParams) return new URLSearchParams(query);
  if (typeof query === "string") return new URLSearchParams(query.replace(/^\?/u, ""));
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== null && value !== undefined && value !== "") result.set(key, String(value));
  return result;
}

export function ovenDefinitionPath(scope: OvenScope): string {
  ovenScopeKey(scope);
  const query = scope.repoKey === null ? "" : `?repoKey=${encodeURIComponent(scope.repoKey)}`;
  return `/api/ovens/${encodeURIComponent(scope.ovenId)}${query}`;
}

/** Console-equivalent data request model, preserving page/control query state. */
export function ovenDataPath(scope: OvenScope, query?: OvenQuery): string {
  ovenScopeKey(scope);
  const params = queryParams(query);
  if (params.has("repoKey") && params.get("repoKey") !== (scope.repoKey ?? null)) throw new Error("Oven query cannot override its repository scope.");
  if (scope.repoKey === null) params.delete("repoKey"); else params.set("repoKey", scope.repoKey);
  const suffix = params.toString();
  return `/api/oven-data/${encodeURIComponent(scope.ovenId)}${suffix ? `?${suffix}` : ""}`;
}

/** Validates the JSON API envelope before terminal IR admission. */
export function adaptOvenDefinition(value: unknown, scope: OvenScope): OvenDefinition {
  ovenScopeKey(scope);
  const resource = inspectJsonBudget(value, { prefix: "PAYLOAD", nodes: TERMINAL_RESOURCE_LIMITS.payloadNodes, depth: TERMINAL_RESOURCE_LIMITS.payloadDepth, stringBytes: TERMINAL_RESOURCE_LIMITS.payloadStringBytes, textBytes: TERMINAL_RESOURCE_LIMITS.payloadTextBytes });
  if (resource) throw new Error(`Oven ${scope.ovenId} returned an invalid runtime definition: ${resource.message}`);
  const oven = record(record(value)?.oven), ir = record(oven?.ir);
  if (!oven || !ir || ir.id !== scope.ovenId || !Array.isArray(ir.root) || !Array.isArray(ir.controls) || !Array.isArray(ir.collections)) {
    throw new Error(`Oven ${scope.ovenId} returned an invalid runtime definition.`);
  }
  const diagnostics = validateTerminalOvenIR(ir);
  if (diagnostics.length) throw new Error(`Oven ${scope.ovenId} returned an invalid runtime definition: ${diagnostics[0]!.message}`);
  if (!scopeText(oven.repoKey) || !revision(oven.ovenRevision)) throw new Error(`Oven ${scope.ovenId} returned an invalid definition scope or revision.`);
  if (oven.repoKey !== null && oven.repoKey !== scope.repoKey) throw new Error(`Oven ${scope.ovenId} resolved outside its requested repository scope.`);
  const fields = ["id", "name", "description", "version", "contract", "dataInput", "instructions", "oven"] as const;
  if (oven.id !== scope.ovenId || fields.some((field) => !safeText(oven[field])) || typeof oven.builtIn !== "boolean" || !["json-payload", "producer-managed"].includes(String(oven.dataInput))) {
    throw new Error(`Oven ${scope.ovenId} returned an invalid package detail.`);
  }
  const freshIr = cloned(ir as unknown as JsonValue) as unknown as TerminalOvenIR;
  const detail: OvenPackageDetail = Object.freeze({
    id: oven.id as string, name: oven.name as string, description: oven.description as string, version: oven.version as string,
    contract: oven.contract as string, builtIn: oven.builtIn as boolean, repoKey: oven.repoKey as string | null,
    dataInput: oven.dataInput as OvenPackageDetail["dataInput"], instructions: oven.instructions as string, oven: oven.oven as string,
    ovenRevision: oven.ovenRevision, ir: freshIr as unknown as OvenPackageDetail["ir"],
  });
  return Object.freeze({ scope: Object.freeze({ ...scope }), definitionRepoKey: oven.repoKey, ovenRevision: oven.ovenRevision, ir: freshIr, detail });
}

/** The metadata sidecar is the console's page-envelope contract. */
export function ovenPageEnvelope(payload: JsonValue | undefined, source: string): OvenPage | undefined {
  const metadata = record(record(payload)?.__burnlistOvenRuntime);
  const raw = record(record(metadata?.collectionPages)?.[source]);
  if (!raw) return undefined;
  const page = pageNumber(raw.page, 0), pageSize = pageNumber(raw.pageSize, 1), pageCount = pageNumber(raw.pageCount, 1), total = pageNumber(raw.total, 0);
  return page === null || pageSize === null || pageCount === null || total === null ? undefined : Object.freeze({ page, pageSize, pageCount, total });
}

export function definitionChangeInvalidates(scope: OvenScope & Readonly<{ definitionRepoKey?: string | null }>, event: unknown): boolean {
  const data = record(event);
  const definitionRepoKey = scope.definitionRepoKey === undefined ? scope.repoKey : scope.definitionRepoKey;
  return !!data && data.kind === "definition-changed" && data.phase === "complete"
    && data.ovenId === scope.ovenId && (data.repoKey ?? null) === definitionRepoKey;
}
