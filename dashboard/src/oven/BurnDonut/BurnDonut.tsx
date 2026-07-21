type BurnEntry = { result?: string };

type BurnGroup = "improved" | "worsened" | "unchanged" | "reverted";

type BurnDonutGroup = {
  name: BurnGroup;
  amount: number;
  color: "improved" | "worsened" | "neutral" | "reverted";
  dash: string;
  offset: string;
};

export function burnDonutCounts(entries: BurnEntry[]): Record<BurnGroup, number> {
  const groups: Record<BurnGroup, number> = { improved: 0, worsened: 0, unchanged: 0, reverted: 0 };
  for (const entry of entries) {
    if (entry.result === "improved" || entry.result === "pass") groups.improved += 1;
    else if (entry.result === "worsened") groups.worsened += 1;
    else if (entry.result === "blocked" || entry.result === "reverted") groups.reverted += 1;
    else groups.unchanged += 1;
  }
  return groups;
}

export function burnDonutGroups(entries: BurnEntry[]): BurnDonutGroup[] {
  const groups = burnDonutCounts(entries);

  const active = (Object.entries(groups) as [BurnGroup, number][])
    .filter(([, amount]) => amount > 0)
    .sort((left, right) => right[1] - left[1]);
  const total = active.reduce((sum, [, amount]) => sum + amount, 0);
  const gap = active.length > 1 ? (58 / 40) / (2 * Math.PI * 21) * 100 : 0;
  let offset = 0;

  return active.map(([name, amount]) => {
    const share = amount / Math.max(1, total) * 100;
    const dash = Math.max(0, share - gap);
    const result = {
      name,
      amount,
      color: name === "unchanged" ? "neutral" : name,
      dash: dash.toFixed(3),
      offset: (-(offset + gap / 2)).toFixed(3),
    } as BurnDonutGroup;
    offset += share;
    return result;
  });
}

export function BurnDonut({ entries }: { entries: BurnEntry[] }) {
  const groups = burnDonutGroups(entries);
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
