function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function ovenDefinitionUrl(id, repoKey = null) {
  const query = repoKey == null ? "" : `?repoKey=${encodeURIComponent(repoKey)}`;
  return `/api/ovens/${encodeURIComponent(id)}${query}`;
}

export function checklistOvenRepoKey(progress, selected) {
  return progress?.repoKey ?? selected?.repoKey ?? null;
}

export async function loadOvenDefinition({ id, repoKey = null, fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl(ovenDefinitionUrl(id, repoKey), {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Could not load Oven ${id} (${response.status}).`);
  const body = record(await response.json());
  const oven = record(body?.oven);
  const ir = record(oven?.ir);
  if (ir?.id !== id || !Array.isArray(ir.root) || !Array.isArray(ir.controls) || !Array.isArray(ir.collections)) {
    throw new Error(`Oven ${id} returned an invalid runtime definition.`);
  }
  return ir;
}
