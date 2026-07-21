function agentInstructions(oven) {
  const label = `${oven.id}@${oven.version}`;
  return [
    `Use the ${oven.name} Oven (${label}).`,
    `Its data must satisfy the ${oven.contract} contract.`,
    "Adopt the Oven before preparing its data:",
    `burnlist oven adopt ${oven.id}`,
    "Produce the required data, then bind it to the target path:",
    `burnlist oven bind ${oven.id} <path>`,
  ].join("\n");
}

function compareOvens(left, right) {
  if (left.builtIn !== right.builtIn) return left.builtIn ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

export function buildOvenCatalog(ovens) {
  return (Array.isArray(ovens) ? ovens : [])
    .map((oven) => {
      const repoQuery = oven.repoKey == null ? "" : `?repoKey=${encodeURIComponent(oven.repoKey)}`;
      return {
        id: oven.id,
        name: oven.name,
        version: oven.version,
        contract: oven.contract,
        description: oven.description,
        builtIn: oven.builtIn,
        repoKey: oven.repoKey,
        label: `${oven.id}@${oven.version}`,
        href: `/ovens/${encodeURIComponent(oven.id)}${repoQuery}`,
        adoptCommand: `burnlist oven adopt ${oven.id}`,
        agentInstructions: agentInstructions(oven),
      };
    })
    .sort(compareOvens);
}
