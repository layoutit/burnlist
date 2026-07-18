import { fieldResult } from "../../../../ovens/differential-testing/renderer/differential-testing-render.js";
import type { FieldMiniChartField } from "../FieldMiniChart/field-mini-chart-geometry";

export type HybridFieldData = FieldMiniChartField & {
  id: string;
  label: string;
  semantics?: { meaning?: string | null };
  driftReason?: string | null;
  sourceOwner?: string | null;
  trustStatus?: string | null;
  failedSampleCount?: number | null;
  missingSampleCount?: number | null;
  maxDelta?: number | string | null;
};

export type HybridFieldProps = {
  field: HybridFieldData;
};

export function HybridField({ field }: HybridFieldProps) {
  const segments = String(field.label || "").split(".");
  const description = field.semantics?.meaning || field.driftReason || field.sourceOwner || "";
  return <span className="hybrid-cell hybrid-field" title={description}>
    <span className="table-field-label">
      {segments.map((segment, index) => {
        const last = index === segments.length - 1;
        const opacity = segments.length <= 1 ? 1 : 0.45 + 0.55 * Math.pow(index / (segments.length - 1), 1.8);
        return <span key={`${segment}-${index}`} className={last ? "hybrid-field-tail" : "hybrid-field-segment"} style={{ opacity: opacity.toFixed(2) }}>{segment}{last ? "" : "."}</span>;
      })}
    </span>
    <span className="hybrid-status">{fieldResult(field)}</span>
  </span>;
}
