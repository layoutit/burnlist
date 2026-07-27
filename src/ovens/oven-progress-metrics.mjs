export function clampProgressPercent(value) {
  const parsed = Number(value);
  return Math.max(0, Math.min(100, Number.isFinite(parsed) ? parsed : 0));
}

export function burnDonutCounts(entries) {
  const groups = { improved: 0, worsened: 0, unchanged: 0, reverted: 0 };
  for (const entry of entries) {
    if (entry?.result === "improved" || entry?.result === "pass") groups.improved += 1;
    else if (entry?.result === "worsened") groups.worsened += 1;
    else if (entry?.result === "blocked" || entry?.result === "reverted") groups.reverted += 1;
    else groups.unchanged += 1;
  }
  return groups;
}

export function burnDonutGroups(entries) {
  const groups = burnDonutCounts(entries);
  const active = Object.entries(groups).filter(([, amount]) => amount > 0).sort((left, right) => right[1] - left[1]);
  const total = active.reduce((sum, [, amount]) => sum + amount, 0);
  const gap = active.length > 1 ? (58 / 40) / (2 * Math.PI * 21) * 100 : 0;
  let offset = 0;
  return active.map(([name, amount]) => {
    const share = amount / Math.max(1, total) * 100;
    const dash = Math.max(0, share - gap);
    const result = { name, amount, color: name === "unchanged" ? "neutral" : name, dash: dash.toFixed(3), offset: (-(offset + gap / 2)).toFixed(3) };
    offset += share;
    return result;
  });
}

/** Deterministic mandatory representation plus normalized largest remainder. */
export function allocateBurnCells(entries, width) {
  const groups = burnDonutGroups(entries);
  const cells = Math.max(1, Math.floor(Number(width) || 0));
  if (!groups.length) return [];
  const represented = groups.slice(0, cells);
  const total = groups.reduce((sum, group) => sum + group.amount, 0);
  const allocation = represented.map((group) => ({ ...group, cells: cells >= groups.length ? 1 : 0 }));
  let remaining = cells - allocation.reduce((sum, group) => sum + group.cells, 0);
  const demand = allocation.map((group, index) => ({ index, value: Math.max(0, group.amount / total * cells - group.cells) }));
  const demandTotal = demand.reduce((sum, item) => sum + item.value, 0);
  const quotas = demand.map((item) => ({ index: item.index, quota: demandTotal ? item.value / demandTotal * remaining : 0 }));
  for (const item of quotas) {
    const whole = Math.floor(item.quota);
    allocation[item.index].cells += whole;
    remaining -= whole;
  }
  quotas.sort((left, right) => (right.quota % 1) - (left.quota % 1) || left.index - right.index);
  for (let index = 0; index < remaining; index += 1) allocation[quotas[index % quotas.length].index].cells += 1;
  return allocation;
}

export function waffleMetricData(metric) {
  const failed = Number(metric?.failed || 0) + Number(metric?.blocked || 0);
  const ratio = metric?.total ? failed / metric.total : 0;
  return { failed, failedCells: Math.min(80, Math.round(ratio * 96)), empty: metric?.total ? false : true };
}
