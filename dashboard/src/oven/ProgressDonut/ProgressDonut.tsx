type ProgressDonutProps = {
  percent: number;
  className?: string;
};

export function ProgressDonut({
  percent,
  className = "driving-parity-kpi-gauge driving-parity-kpi-progress-donut",
}: ProgressDonutProps) {
  const donePercent = Math.max(0, Math.min(100, percent));
  const remainingPercent = Math.max(0, 100 - donePercent);
  return <svg aria-hidden="true" className={className} viewBox="0 0 58 58"><circle className="driving-parity-kpi-progress-donut-track" cx="29" cy="29" r="21" /><circle className="driving-parity-kpi-progress-donut-segment" cx="29" cy="29" r="21" pathLength="100" strokeDasharray={`${donePercent.toFixed(3)} ${remainingPercent.toFixed(3)}`} transform="rotate(-90 29 29)" /></svg>;
}
