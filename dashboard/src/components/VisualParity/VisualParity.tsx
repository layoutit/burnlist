import { useEffect, useMemo, useState } from "react";
import { useVisualParityData } from "@hooks";
import { visualParityDomainSummary } from "@lib";
import { DomainNote, DomainTabs, FrameCard, MetricTiles, VerdictHeader } from "@oven";

export function VisualParityPage() {
  const { payload, error, loading } = useVisualParityData();
  const initialDomain = payload?.domains.find((domain) => domain.qualification === "target")?.id
    ?? payload?.domains[0]?.id ?? "";
  const [selectedDomainId, setSelectedDomainId] = useState(initialDomain);

  useEffect(() => {
    if (!payload?.domains.length) return;
    if (!payload.domains.some((domain) => domain.id === selectedDomainId)) {
      setSelectedDomainId(payload.domains.find((domain) => domain.qualification === "target")?.id
        ?? payload.domains[0].id);
    }
  }, [payload, selectedDomainId]);

  const domain = payload?.domains.find((entry) => entry.id === selectedDomainId)
    ?? payload?.domains.find((entry) => entry.qualification === "target")
    ?? payload?.domains[0];
  const summary = useMemo(() => payload && domain
    ? visualParityDomainSummary(payload, domain.id) : null, [payload, domain]);
  const targetPass = payload?.comparisons.every((comparison) => comparison.status === "pass") ?? false;
  const visibleComparisons = payload && domain ? payload.comparisons.filter((comparison) => {
    const entry = comparison.domains[domain.id];
    return entry.reference.src && entry.candidate.src && entry.diff.src;
  }) : [];

  if (loading && !payload) return <div className="visual-parity-state">Loading Visual Parity…</div>;
  if (error && !payload) return <div className="visual-parity-state is-error">{error}</div>;
  if (!payload || !domain || !summary) return <div className="visual-parity-state">Visual Parity has no retained domains.</div>;

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
