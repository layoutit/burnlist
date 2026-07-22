export function officialOvenSampleAllowed(entry, inventory) {
  if (!entry || !["official", "vendored"].includes(entry.origin)) return false;
  if (entry.origin === "official") return true;
  const official = (inventory ?? []).find((candidate) => candidate.id === entry.id && candidate.origin === "official");
  return Boolean(official && official.ovenRevision === entry.ovenRevision);
}
