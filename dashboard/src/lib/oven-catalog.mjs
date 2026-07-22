function titleCase(value) {
  return String(value ?? "").replaceAll("-", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function officialAgentInstructions(oven) {
  const instructions = [
    `Use the official ${oven.name} Oven (${oven.id}@${oven.version}).`,
    "Do not invent a replacement Oven, renderer, or data contract.",
    `Its normalized data must satisfy ${oven.contract}.`,
    `Use the source-owned producer: ${oven.producer}.`,
    "Install the shipped Oven in the target repository:",
    `burnlist oven use ${oven.id}`,
  ];
  if (oven.dataInput === "json-payload") {
    instructions.push("Publish the producer's real JSON, then set it:", `burnlist oven set ${oven.id} <path>`);
  } else {
    instructions.push("Its data is producer-managed; use the named producer workflow.");
  }
  instructions.push(
    `Canonical acceptance is ${oven.acceptance.state}.`,
    "Only canonical-oven evidence from the named producer qualifies; fixtures do not.",
  );
  return instructions.join("\n");
}

function inventoryOrigin(oven) {
  if (["official", "vendored", "custom"].includes(oven.origin)) return oven.origin;
  if (!oven.builtIn) return "custom";
  return oven.repoKey == null ? "official" : "vendored";
}

function localAgentInstructions(oven, origin) {
  if (origin === "official") {
    const instructions = [
      `Use the official ${oven.name} Oven (${oven.id}@${oven.version}).`,
      `Its data must satisfy ${oven.contract}.`,
      "Install the shipped Oven in the target repository:",
      `burnlist oven use ${oven.id}`,
    ];
    if (oven.dataInput === "json-payload") {
      instructions.push("Produce the required JSON data, then set it:", `burnlist oven set ${oven.id} <path>`);
    } else {
      instructions.push("Its data is producer-managed; use its producer workflow.");
    }
    return instructions.join("\n");
  }
  const instructions = [
    `Use the repository ${origin} Oven ${oven.name} (${oven.id}@${oven.version}).`,
    `Its data must satisfy ${oven.contract}.`,
    "This local entry is already available in its repository; it is not official catalog membership.",
  ];
  if (oven.dataInput === "json-payload") {
    instructions.push("Produce its required JSON, then set it:", `burnlist oven set ${oven.id} <path>`);
  } else {
    instructions.push("Its data is producer-managed; use its repository producer workflow.");
  }
  return instructions.join("\n");
}

function compareInventory(left, right) {
  const ranks = { official: 0, vendored: 1, custom: 2 };
  return ranks[left.origin] - ranks[right.origin]
    || left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
    || String(left.repoKey).localeCompare(String(right.repoKey));
}

export function buildOfficialOvenCatalog(entries) {
  return (Array.isArray(entries) ? entries : []).map((oven) => ({
    ...oven,
    origin: "official",
    repoKey: null,
    label: `${oven.id}@${oven.version}`,
    href: `/ovens/${encodeURIComponent(oven.id)}`,
    maturityLabel: titleCase(oven.maturity),
    acceptanceLabel: titleCase(oven.acceptance?.state),
    agentInstructions: officialAgentInstructions(oven),
  }));
}

export function buildOvenCatalog(ovens) {
  return (Array.isArray(ovens) ? ovens : [])
    .map((oven) => {
      const origin = inventoryOrigin(oven);
      const repoQuery = oven.repoKey == null ? "" : `?repoKey=${encodeURIComponent(oven.repoKey)}`;
      return {
        ...oven,
        origin,
        label: `${oven.id}@${oven.version}`,
        href: `/ovens/${encodeURIComponent(oven.id)}${repoQuery}`,
        agentInstructions: localAgentInstructions(oven, origin),
      };
    })
    .sort(compareInventory);
}

export function buildLocalOvenInventory(ovens) {
  return buildOvenCatalog(ovens).filter(({ origin }) => origin !== "official");
}
