export type VisualParityDifference = {
  changedPixels: number;
  totalPixels: number;
  ratio: number;
  meanAbsoluteDelta: number;
  maximumAbsoluteDelta: number;
};

export type VisualParityImage = {
  label: string;
  src: string | null;
  width: number;
  height: number;
};

export type VisualParityDomain = {
  id: string;
  label: string;
  isolation: "render-pass";
  qualification: "target" | "context";
  tolerance?: {
    channelDelta: number;
    meanAbsoluteDelta: number;
    changedPixelRatio: number;
    rationale: string;
  };
};

export type VisualParityDomainComparison = {
  label: string;
  status: "pass" | "fail";
  reference: VisualParityImage;
  candidate: VisualParityImage;
  diff: VisualParityImage;
  difference: VisualParityDifference;
};

export type VisualParityPayload = {
  schema: "burnlist-visual-parity-data@1";
  domains: VisualParityDomain[];
  differentialTesting: Record<string, unknown>;
  comparisons: Array<{
    id: string;
    label: string;
    frame: number;
    status: "pass" | "fail";
    domains: Record<string, VisualParityDomainComparison>;
  }>;
};

export function visualParityDomainSummary(payload: VisualParityPayload, domainId: string) {
  const entries = payload.comparisons.map((comparison) => comparison.domains[domainId]);
  const changedPixels = entries.reduce((sum, entry) => sum + entry.difference.changedPixels, 0);
  const totalPixels = entries.reduce((sum, entry) => sum + entry.difference.totalPixels, 0);
  const absoluteDelta = entries.reduce((sum, entry) => (
    sum + entry.difference.meanAbsoluteDelta * entry.difference.totalPixels * 3
  ), 0);
  return {
    passed: entries.filter((entry) => entry.status === "pass").length,
    failed: entries.filter((entry) => entry.status === "fail").length,
    ratio: totalPixels ? changedPixels / totalPixels : 0,
    meanAbsoluteDelta: totalPixels ? absoluteDelta / (totalPixels * 3) : 0,
    maximumAbsoluteDelta: entries.reduce((maximum, entry) => (
      Math.max(maximum, entry.difference.maximumAbsoluteDelta)
    ), 0),
  };
}
