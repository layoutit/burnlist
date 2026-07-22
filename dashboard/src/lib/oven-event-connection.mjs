function activeScope(entries) {
  const repoKeys = new Set();
  const ovenIds = new Set();
  let allRepos = false;
  for (const entry of entries) {
    if (!entry.listeners.size) continue;
    if (entry.repoKey === null) allRepos = true;
    else repoKeys.add(entry.repoKey);
    ovenIds.add(entry.ovenId);
    for (const selector of entry.events) {
      if (selector.ovenId !== "*") ovenIds.add(selector.ovenId);
    }
  }
  if (!ovenIds.size) return null;
  const scope = {
    repoKeys: allRepos ? [] : [...repoKeys].sort(),
    ovenIds: [...ovenIds].sort(),
  };
  return { ...scope, key: JSON.stringify(scope) };
}

function feedUrl(scope, mode, cursor = "") {
  const query = new URLSearchParams({ [mode]: "1" });
  for (const repoKey of scope.repoKeys) query.append("repoKey", repoKey);
  for (const ovenId of scope.ovenIds) query.append("ovenId", ovenId);
  if (cursor) query.set("after", cursor);
  return `/api/events?${query}`;
}

function invalidSource(source) {
  return !source || typeof source.addEventListener !== "function" || typeof source.close !== "function";
}

export function createOvenEventConnection({
  entries,
  fetchImpl,
  eventSourceFactory,
  onEvent,
  onReset,
  onOpen,
} = {}) {
  let started = false;
  let generation = 0;
  let source = null;
  let sourceKey = "";
  let pendingKey = "";
  let task = null;
  let error = "";

  const closeSource = () => {
    if (!source) return;
    source.removeEventListener?.("oven-event", onEvent);
    source.removeEventListener?.("oven-reset", onReset);
    source.close();
    source = null;
    sourceKey = "";
  };

  const sync = () => {
    if (!started) return null;
    const scope = activeScope(entries());
    if (!scope) {
      generation += 1;
      pendingKey = "";
      error = "";
      closeSource();
      return null;
    }
    if (source && sourceKey === scope.key) return null;
    if (task && pendingKey === scope.key) return task;
    const current = ++generation;
    pendingKey = scope.key;
    closeSource();
    const next = Promise.resolve()
      .then(() => fetchImpl(feedUrl(scope, "tail"), { cache: "no-store" }))
      .then(async (response) => {
        if (!response.ok) throw new Error(`Oven event baseline failed (${response.status})`);
        const baseline = await response.json();
        if (typeof baseline?.cursor !== "string" || !baseline.cursor) {
          throw new Error("Oven event baseline cursor is missing.");
        }
        if (!started || generation !== current || activeScope(entries())?.key !== scope.key) return;
        const candidate = eventSourceFactory(feedUrl(scope, "stream", baseline.cursor));
        if (invalidSource(candidate)) throw new Error("Oven EventSource factory returned an invalid source.");
        source = candidate;
        sourceKey = scope.key;
        candidate.addEventListener("oven-event", onEvent);
        candidate.addEventListener("oven-reset", onReset);
        candidate.onopen = () => { error = ""; onOpen?.(); };
        candidate.onerror = () => { error = "Oven event stream disconnected; canonical fallback remains active."; };
      })
      .catch((cause) => {
        if (generation === current) error = cause instanceof Error ? cause.message : "Could not establish the Oven event baseline.";
      })
      .finally(() => {
        if (task === next) task = null;
        if (pendingKey === scope.key) pendingKey = "";
      });
    task = next;
    return next;
  };

  return Object.freeze({
    start() { if (!started) { started = true; generation += 1; } return sync(); },
    sync,
    stop() {
      if (!started) return;
      started = false;
      generation += 1;
      pendingKey = "";
      task = null;
      closeSource();
    },
    stats: () => ({ eventSources: source ? 1 : 0, observerError: error }),
  });
}
