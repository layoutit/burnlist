import { burnDonutCounts, burnDonutGroups } from "../../../../src/ovens/oven-progress-metrics.mjs";
export { burnDonutCounts, burnDonutGroups };
type BurnEntry = { result?: string };

export function BurnDonut({ entries }: { entries: BurnEntry[] }) {
  const groups = burnDonutGroups(entries) as Array<{ name: string; amount: number; color: string; dash: string; offset: string }>;
  const total = groups.reduce((sum, group) => sum + group.amount, 0);
  return <svg aria-hidden="true" className="driving-parity-kpi-gauge driving-parity-kpi-burns-donut" viewBox="0 0 58 58">
    <circle className="driving-parity-kpi-burns-donut-track" cx="29" cy="29" r="21" opacity={total ? "0" : undefined} />
    {groups.map((group) => <circle
      className={`driving-parity-kpi-burns-donut-segment ${group.color}`}
      cx="29"
      cy="29"
      r="21"
      pathLength="100"
      transform="rotate(-90 29 29)"
      strokeDasharray={`${group.dash} ${(100 - Number(group.dash)).toFixed(3)}`}
      strokeDashoffset={group.offset}
      key={group.name}
    />)}
  </svg>;
}
