export function DifferentialEmptyState({ title = "Differential Testing" }: { title?: string }) {
  return <main className="differential-testing-empty-state">
    <div className="driving-parity-kpi-title-item">
      <span className="driving-parity-kpi-title">{title}</span>
      <span className="driving-parity-kpi-title-subtitle">
        <span className="differential-scenario-control">
          <select id="differential-scenario-selector" aria-label="Differential Testing scenario" disabled defaultValue="No scenarios">
            <option>No scenarios</option>
          </select>
        </span>
      </span>
    </div>
    <div className="differential-testing-empty-message">No Differential Testing scenarios</div>
  </main>;
}
