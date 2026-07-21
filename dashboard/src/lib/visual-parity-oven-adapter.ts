import { visualParityDomainSummary, type VisualParityPayload } from "@lib";

export function adaptVisualParity(payload: VisualParityPayload) {
  const domains = payload.domains.map((domain) => ({
    id: domain.id,
    label: domain.label,
    qualification: domain.qualification,
    failed: visualParityDomainSummary(payload, domain.id).failed,
  }));
  const byDomain = Object.fromEntries(payload.domains.map((domain) => {
    const summary = visualParityDomainSummary(payload, domain.id);
    return [domain.id, {
      summary: {
        passed: summary.passed,
        total: payload.comparisons.length,
        ratio: summary.ratio,
        meanAbsoluteDelta: summary.meanAbsoluteDelta,
        maximumAbsoluteDelta: summary.maximumAbsoluteDelta,
      },
      note: {
        isTarget: domain.qualification === "target",
        rationale: domain.tolerance?.rationale ?? "Exact zero tolerance.",
      },
      frames: payload.comparisons.flatMap((comparison) => {
        const entry = comparison.domains[domain.id];
        return entry.reference.src && entry.candidate.src && entry.diff.src
          ? [{ status: entry.status, frame: comparison.frame, difference: entry.difference, images: [entry.reference, entry.candidate, entry.diff], label: entry.label }]
          : [];
      }),
    }];
  }));
  return {
    verdict: {
      targetPass: payload.comparisons.every((comparison) => comparison.status === "pass"),
      framesCount: payload.comparisons.length,
      error: "",
    },
    domains,
    initialDomainId: domains.find((domain) => domain.qualification === "target")?.id ?? domains[0].id,
    byDomain,
  };
}
