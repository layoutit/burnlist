import type { JsonValue } from "./terminal-contract";
import { adaptVisualParity } from "../../../dashboard/src/lib/visual-parity-oven-adapter";
import type { VisualParityPayload } from "../../../dashboard/src/lib/visual-parity";

const record = (value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Readonly<Record<string, JsonValue>> : null;

/**
 * Retains the declared Visual Parity render model while dropping producer-only
 * per-cell scene metadata. The console may inspect those tiles; frame-card does
 * not bind them and the terminal must not admit millions of unused JSON nodes.
 */
export function terminalPayload(contract: string, payload: JsonValue): JsonValue {
  if (contract !== "burnlist-visual-parity-data@1") return payload;
  const source = record(payload);
  const adapted = source && Array.isArray(source.domains) && Array.isArray(source.comparisons) && !source.byDomain
    ? adaptVisualParity(payload as unknown as VisualParityPayload) as unknown as JsonValue
    : payload;
  const root = record(adapted), domains = record(root?.byDomain);
  if (!root || !domains) return payload;
  const byDomain = Object.fromEntries(Object.entries(domains).map(([id, value]) => {
    const domain = record(value);
    if (!domain || !Array.isArray(domain.frames)) return [id, value];
    const frames = domain.frames.map((value) => {
      const frame = record(value);
      if (!frame || !Object.hasOwn(frame, "tiles")) return value;
      const { tiles: _tiles, ...retained } = frame;
      return retained;
    });
    return [id, { ...domain, frames }];
  }));
  return {
    ...(root.schema !== undefined ? { schema: root.schema } : {}),
    ...(root.initialDomainId !== undefined ? { initialDomainId: root.initialDomainId } : {}),
    ...(root.domains !== undefined ? { domains: root.domains } : {}),
    ...(root.verdict !== undefined ? { verdict: root.verdict } : {}),
    byDomain,
  };
}
