function activeScope(entries) {
  const repoKeys = new Set();
  const ovenIds = new Set();
  let allRepos = false;
  let wildcard = false;
  for (const entry of entries) {
    if (!entry.listeners.size) continue;
    if (entry.repoKey === null) allRepos = true;
    else repoKeys.add(entry.repoKey);
    ovenIds.add(entry.ovenId);
    for (const selector of entry.events) {
      if (selector.ovenId === "*") wildcard = true;
      else ovenIds.add(selector.ovenId);
    }
  }
  if (!ovenIds.size) return null;
  const scope = {
    repoKeys: allRepos ? [] : [...repoKeys].sort(),
    ovenIds: wildcard ? [] : [...ovenIds].sort(),
    wildcard,
  };
  return { ...scope, key: JSON.stringify(scope) };
}

function feedUrl(scope, mode, cursor = "") {
  const query = scope.wildcard
    ? new URLSearchParams({ stream: "1", tail: "1" })
    : new URLSearchParams({ [mode]: "1" });
  for (const repoKey of scope.repoKeys) query.append("repoKey", repoKey);
  for (const ovenId of scope.ovenIds) query.append("ovenId", ovenId);
  if (!scope.wildcard && cursor) query.set("after", cursor);
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

  const attachSource = (scope, cursor, current) => {
    if (!started || generation !== current || activeScope(entries())?.key !== scope.key) return;
    const candidate = eventSourceFactory(feedUrl(scope, "stream", cursor));
    if (invalidSource(candidate)) throw new Error("Oven EventSource factory returned an invalid source.");
    source = candidate;
    sourceKey = scope.key;
    candidate.addEventListener("oven-event", onEvent);
    candidate.addEventListener("oven-reset", onReset);
    candidate.onopen = () => { error = ""; onOpen?.({ liveTail: scope.wildcard }); };
    candidate.onerror = () => { error = "Oven event stream disconnected; canonical fallback remains active."; };
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
    const next = (scope.wildcard
      ? Promise.resolve().then(() => attachSource(scope, "", current))
      : Promise.resolve()
        .then(() => fetchImpl(feedUrl(scope, "tail"), { cache: "no-store" }))
        .then(async (response) => {
          if (!response.ok) throw new Error(`Oven event baseline failed (${response.status})`);
          const baseline = await response.json();
          if (typeof baseline?.cursor !== "string" || !baseline.cursor) {
            throw new Error("Oven event baseline cursor is missing.");
          }
          attachSource(scope, baseline.cursor, current);
        }))
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
