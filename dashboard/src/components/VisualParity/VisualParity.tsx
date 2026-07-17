import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useVisualParityData } from "@hooks";
import { visualParityDomainSummary } from "@lib";

function percent(value: number) {
  return `${(value * 100).toFixed(value < 0.01 ? 3 : 2)}%`;
}

function delta(value: number) {
  return value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
}

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
      <header className="visual-parity-heading">
        <a className="visual-parity-back" href="/"><ArrowLeft aria-hidden="true" />Burnlists</a>
        <div>
          <div className={`visual-parity-verdict ${targetPass ? "pass" : "fail"}`}>
            {targetPass ? "Target qualified" : "Target open"}
          </div>
          <p>{payload.comparisons.length} settled frames · isolated render passes · live refresh</p>
        </div>
        {error && <span className="visual-parity-refresh-error">{error}</span>}
      </header>

      <nav aria-label="Visual parity domains" className="visual-parity-domains">
        {payload.domains.map((entry) => {
          const current = entry.id === domain.id;
          const domainSummary = visualParityDomainSummary(payload, entry.id);
          return (
            <button
              aria-pressed={current}
              className={current ? "is-active" : ""}
              key={entry.id}
              onClick={() => setSelectedDomainId(entry.id)}
              type="button"
            >
              <span>{entry.label}</span>
              <small>{entry.qualification} · {domainSummary.failed ? `${domainSummary.failed} fail` : "pass"}</small>
            </button>
          );
        })}
      </nav>

      <div className="visual-parity-metrics">
        <article><span>Frames</span><strong>{summary.passed}/{payload.comparisons.length}</strong></article>
        <article><span>Changed pixels</span><strong>{percent(summary.ratio)}</strong></article>
        <article><span>Mean RGB delta</span><strong>{delta(summary.meanAbsoluteDelta)}</strong></article>
        <article><span>Maximum delta</span><strong>{summary.maximumAbsoluteDelta}</strong></article>
      </div>

      <div className="visual-parity-domain-note">
        <strong>{domain.qualification === "target" ? "Qualifying target" : "Diagnostic context"}</strong>
        <span>{domain.tolerance?.rationale ?? "Exact zero tolerance."}</span>
      </div>

      <div className="visual-parity-frames">
        {visibleComparisons.map((comparison) => {
          const entry = comparison.domains[domain.id];
          return (
            <article className={`visual-parity-frame ${entry.status}`} key={comparison.id}>
              <header>
                <strong>Frame {comparison.frame}</strong>
                <span>{entry.status} · {percent(entry.difference.ratio)} · mean {delta(entry.difference.meanAbsoluteDelta)} · max {entry.difference.maximumAbsoluteDelta}</span>
              </header>
              <div className="visual-parity-shots">
                {[entry.reference, entry.candidate, entry.diff].map((image) => (
                  <figure key={image.label}>
                    <figcaption>{image.label}</figcaption>
                    <img alt={`${entry.label} ${image.label.toLowerCase()} frame ${comparison.frame}`} height={image.height} src={image.src ?? undefined} width={image.width} />
                  </figure>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
