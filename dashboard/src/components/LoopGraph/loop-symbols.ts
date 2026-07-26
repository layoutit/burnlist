import type { LoopGraphNode, LoopGraphProjection } from "./LoopGraph";

const preferredOutcomes = ["complete", "measured", "pass", "target-met", "approve", "success"];

export function loopSymbols(nodes: LoopGraphNode[], overrides: Record<string, string> = {}) {
  const totals = new Map<string, number>();
  const seen = new Map<string, number>();
  const bases = nodes.map((node) => {
    if (/^implement/u.test(node.id)) return "I";
    if (/^(verify|validate|measure)/u.test(node.id)) return "V";
    if (/^review/u.test(node.id)) return "R";
    if (/^(converged|.*-gate$)/u.test(node.id) || node.kind === "gate") return "G";
    if (/^completed/u.test(node.id)) return "C";
    if (/^plan/u.test(node.id)) return "P";
    if (/^combine/u.test(node.id)) return "M";
    if (/needs-human/u.test(node.id)) return "H";
    return node.id.match(/[a-z0-9]/iu)?.[0]?.toUpperCase() ?? "N";
  });
  for (const base of bases) totals.set(base, (totals.get(base) ?? 0) + 1);
  return new Map(nodes.map((node, index) => {
    const base = bases[index];
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return [node.id, overrides[node.id] ?? (totals.get(base)! > 1 ? `${base}${occurrence}` : base)];
  }));
}

export function loopPrimaryPath(graph: LoopGraphProjection["graph"]) {
  const entry = graph.entry ?? graph.nodes[0]?.id;
  if (!entry) return [];
  const path = [entry], seen = new Set(path);
  let current = entry;
  while (current) {
    const candidates = graph.edges.filter((edge) => edge.from === current && !seen.has(edge.to));
    candidates.sort((left, right) => {
      const rank = (outcome: string) => {
        const index = preferredOutcomes.indexOf(outcome);
        return index < 0 ? preferredOutcomes.length : index;
      };
      return rank(left.on) - rank(right.on) || left.on.localeCompare(right.on);
    });
    const next = candidates[0];
    if (!next) break;
    path.push(next.to);
    seen.add(next.to);
    current = next.to;
  }
  return path;
}
