import { nonPass } from "../differential-testing-render/differential-testing-render.js";
import { FieldMiniChart } from "../FieldMiniChart";
import type { HybridFieldData } from "../HybridField";
import { HybridField } from "../HybridField";
import type { HybridTelemetry } from "../HybridMetric";
import { HybridMetric } from "../HybridMetric";

export type TelemetryAvailability = {
  status: string;
  reason: string;
};

export type TelemetryByField = ReadonlyMap<string, HybridTelemetry> | Record<string, HybridTelemetry | undefined>;

export type HybridFieldListProps = {
  fields: HybridFieldData[];
  expanded?: ReadonlySet<string>;
  onToggle?: (id: string) => void;
  telemetryByField?: TelemetryByField;
  chartMode: string;
  sort?: string;
  telemetryAvailability?: TelemetryAvailability;
};

function telemetryForField(telemetryByField: TelemetryByField | undefined, id: string): HybridTelemetry | undefined {
  if (!telemetryByField) return undefined;
  return typeof telemetryByField.get === "function" ? telemetryByField.get(id) : telemetryByField[id];
}

export function HybridFieldList({
  fields,
  expanded = new Set<string>(),
  onToggle,
  telemetryByField,
  chartMode,
  sort = "default",
  telemetryAvailability = { status: "absent", reason: "" },
}: HybridFieldListProps) {
  if (!fields.length) {
    const message = sort === "changed"
      ? telemetryAvailability.status === "comparable"
        ? "No changed fields in this telemetry."
        : telemetryAvailability.reason
      : "No fields match the current view.";
    return <div className="empty">{message}</div>;
  }

  return <div className="hybrid-list">
    {fields.map((field, index) => {
      const isExpanded = expanded.has(field.id);
      return <section
        key={field.id}
        className={`hybrid-row ${nonPass(field) ? "fail" : "pass"}${isExpanded ? " expanded" : ""}`}
        data-row-expand-key={field.id}
        role="button"
        tabIndex={0}
        aria-expanded={String(isExpanded)}
        title={field.label}
        onClick={() => onToggle?.(field.id)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onToggle?.(field.id);
        }}
      >
        <HybridField field={field} />
        <HybridMetric field={field} telemetry={telemetryForField(telemetryByField, field.id)} />
        <div className="hybrid-chart"><FieldMiniChart field={field} showFrameLabels={index === 0} chartMode={chartMode} /></div>
      </section>;
    })}
  </div>;
}
