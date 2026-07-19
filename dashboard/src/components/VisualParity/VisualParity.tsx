import { useEffect, useState } from "react";
import { useVisualParityData } from "@hooks";
import { VisualParityView } from "./VisualParityView";

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

  if (loading && !payload) return <div className="visual-parity-state">Loading Visual Parity…</div>;
  if (error && !payload) return <div className="visual-parity-state is-error">{error}</div>;
  if (!payload || !payload.domains.length) return <div className="visual-parity-state">Visual Parity has no retained domains.</div>;

  return <VisualParityView payload={payload} selectedDomainId={selectedDomainId} error={error} />;
}
