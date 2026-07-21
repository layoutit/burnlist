import { useEffect, useState } from "react";
import { visualParityDomainSummary, type VisualParityPayload } from "@lib";
import { DomainNote, DomainTabs, FrameCard, MetricTiles, VerdictHeader } from "@oven";

export function VisualParityView({ payload, selectedDomainId: initialDomainId, error }: { payload: VisualParityPayload; selectedDomainId: string; error: string }) {
  const [selectedDomainId, setSelectedDomainId] = useState(initialDomainId);

  useEffect(() => {
    setSelectedDomainId(initialDomainId);
  }, [initialDomainId]);

  const domain = payload.domains.find((entry) => entry.id === selectedDomainId)
    ?? payload.domains.find((entry) => entry.qualification === "target")
    ?? payload.domains[0];
  const summary = visualParityDomainSummary(payload, domain.id);
  const targetPass = payload.comparisons.every((comparison) => comparison.status === "pass");
  const visibleComparisons = payload.comparisons.filter((comparison) => {
    const entry = comparison.domains[domain.id];
    return entry.reference.src && entry.candidate.src && entry.diff.src;
  });

  return (
    <section className="visual-parity-page">
      <VerdictHeader targetPass={targetPass} framesCount={payload.comparisons.length} error={error} />
      <DomainTabs tabs={payload.domains.map((entry) => ({ id: entry.id, label: entry.label, qualification: entry.qualification, failed: visualParityDomainSummary(payload, entry.id).failed }))} activeId={domain.id} onSelect={setSelectedDomainId} />
      <MetricTiles passed={summary.passed} total={payload.comparisons.length} ratio={summary.ratio} meanAbsoluteDelta={summary.meanAbsoluteDelta} maximumAbsoluteDelta={summary.maximumAbsoluteDelta} />
      <DomainNote isTarget={domain.qualification === "target"} rationale={domain.tolerance?.rationale ?? "Exact zero tolerance."} />

      <div className="visual-parity-frames">
        {visibleComparisons.map((comparison) => {
          const entry = comparison.domains[domain.id];
          return <FrameCard key={comparison.id} status={entry.status} frame={comparison.frame} difference={entry.difference} images={[entry.reference, entry.candidate, entry.diff]} label={entry.label} />;
        })}
      </div>
    </section>
  );
}
