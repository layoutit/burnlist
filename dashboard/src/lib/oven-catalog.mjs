function agentInstructions(oven) {
  const label = `${oven.id}@${oven.version}`;
  const instructions = [
    `Use the ${oven.name} Oven (${label}).`,
    `Its data must satisfy the ${oven.contract} contract.`,
  ];
  if (oven.builtIn && oven.repoKey == null) {
    instructions.push("Install the shipped Oven in the target repository:", `burnlist oven use ${oven.id}`);
  } else {
    instructions.push("This Oven is already available in its repository.");
  }
  if (oven.dataInput === "json-payload") {
    instructions.push("Produce the required JSON data, then set it:", `burnlist oven set ${oven.id} <path>`);
  } else {
    instructions.push("Its data is producer-managed; publish it with the Oven's producer workflow.");
  }
  return instructions.join("\n");
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
        dataInput: oven.dataInput,
        label: `${oven.id}@${oven.version}`,
        href: `/ovens/${encodeURIComponent(oven.id)}${repoQuery}`,
        agentInstructions: agentInstructions(oven),
      };
    })
    .sort(compareOvens);
}
