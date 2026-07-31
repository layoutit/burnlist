const keyPattern = /^[a-f0-9]{12}$/u;
const MULTI_MONITOR_RECENT_MS = 30 * 60_000;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validSession(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 160
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function multiMonitorFeedKey(identity) {
  return object(identity) && keyPattern.test(identity.logicalRepoKey ?? "")
    && keyPattern.test(identity.worktreeKey ?? "") && validSession(identity.session)
    ? `${identity.logicalRepoKey}:${identity.worktreeKey}:${identity.session}`
    : "";
}

export function parseMultiMonitorSelections({ repoKey, search = "" } = {}) {
  if (!keyPattern.test(repoKey ?? "")) return [];
  const selections = [];
  const seen = new Set();
  for (const token of new URLSearchParams(search).getAll("thread")) {
    const first = token.indexOf(":");
    const second = token.indexOf(":", first + 1);
    const firstKey = token.slice(0, first);
    const secondKey = token.slice(first + 1, second);
    const crossRepository = first >= 0 && second >= 0
      && keyPattern.test(firstKey) && keyPattern.test(secondKey);
    const logicalRepoKey = crossRepository ? firstKey : repoKey;
    const worktreeKey = crossRepository ? secondKey : firstKey;
    const session = token.slice((crossRepository ? second : first) + 1);
    if (first < 0 || !keyPattern.test(worktreeKey) || !validSession(session)) continue;
    const selection = { logicalRepoKey, worktreeKey, session };
    const key = multiMonitorFeedKey(selection);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    selections.push(selection);
  }
  return selections;
}

export function multiMonitorHasExplicitEmpty(search = "") {
  return new URLSearchParams(search).get("columns") === "empty";
}

export function multiMonitorHref({ repoKey, selections = [], explicitEmpty = false } = {}) {
  const query = new URLSearchParams();
  for (const selection of selections) {
    const key = multiMonitorFeedKey(selection);
    if (key) query.append("thread", key);
  }
  if (!query.has("thread") && explicitEmpty) query.set("columns", "empty");
  const search = query.toString();
  return `/r/${encodeURIComponent(repoKey)}/o/multi-monitor${search ? `?${search}` : ""}`;
}

function selectableCodexFeed(feed) {
  return multiMonitorFeedKey(feed?.identity)
    && feed.provider === "codex"
    && feed.topLevel === true
    && feed.caughtUp === true;
}

function currentCodexFeed(feed, nowMs) {
  const activityAt = Date.parse(feed?.activityAt ?? "");
  return selectableCodexFeed(feed)
    && Number.isFinite(activityAt)
    && nowMs - activityAt >= 0
    && nowMs - activityAt <= MULTI_MONITOR_RECENT_MS;
}

export function multiMonitorAvailableFeeds(feeds = [], selections = [], nowMs = Date.now()) {
  const selected = new Set(selections.map(multiMonitorFeedKey));
  return feeds.filter((feed) => {
    const key = currentCodexFeed(feed, nowMs) ? multiMonitorFeedKey(feed.identity) : "";
    return key && !selected.has(key);
  });
}

export function multiMonitorDefaultSelections(feeds = [], nowMs = Date.now()) {
  return feeds
    .filter((feed) => currentCodexFeed(feed, nowMs))
    .map((feed) => feed.identity);
}

function messageRole(event) {
  const subtype = String(event?.eventType ?? "").split("/").at(-1);
  return subtype === "user_message" ? "user" : subtype === "agent_message" ? "agent" : null;
}

function compactTitle(value) {
  const title = String(value ?? "")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
  return title.length > 72 ? `${title.slice(0, 69).trimEnd()}…` : title;
}

export function multiMonitorThreadTitle(payload, fallback = "") {
  const completed = object(payload?.raw) && Array.isArray(payload.raw.completed)
    ? payload.raw.completed
    : [];
  for (let index = completed.length - 1; index >= 0; index -= 1) {
    const event = completed[index];
    if (messageRole(event) !== "user") continue;
    const title = compactTitle(event?.message ?? event?.detail);
    if (title) return title;
  }
  return compactTitle(fallback);
}

function eventTime(event) {
  const value = Date.parse(event?.time ?? event?.completedAt ?? "");
  return Number.isFinite(value) ? value : null;
}

function durationLabel(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return [
    hours ? `${hours}h` : "",
    minutes ? `${minutes}m` : "",
    `${remainder}s`,
  ].filter(Boolean).join(" ");
}

function patchFiles(events) {
  const files = new Map();
  const ensure = (path) => {
    const raw = String(path ?? "").replace(/^[ab]\//u, "").trim();
    const repositoryPath = /(?:^|\/)((?:audits|dashboard|loops|ovens|scripts|skills|src|tui)\/.+)$/u.exec(raw);
    const clean = repositoryPath?.[1] ?? raw.replace(/^\/Users\/[^/]+\//u, "~/");
    if (!clean) return null;
    if (!files.has(clean)) files.set(clean, { path: clean, additions: 0, removals: 0 });
    return files.get(clean);
  };
  for (const event of events) {
    let current = null;
    const lines = Array.isArray(event?.patch?.lines) ? event.patch.lines : [];
    for (const line of lines) {
      const fileHeader = /^(?:\*\*\* (?:Add|Update|Delete) File: |\+\+\+ b\/)(.+)$/u.exec(line);
      const gitHeader = /^diff --git a\/(.+?) b\/(.+)$/u.exec(line);
      if (fileHeader) {
        current = ensure(fileHeader[1]);
      } else if (gitHeader) {
        current = ensure(gitHeader[2]);
      } else if (current && line.startsWith("+") && !line.startsWith("+++")) {
        current.additions += 1;
      } else if (current && line.startsWith("-") && !line.startsWith("---")) {
        current.removals += 1;
      }
    }
    if (!lines.length) {
      const fallback = /^Patch\s+(.+?)(?:\s+·|$)/u.exec(String(event?.detail ?? ""))?.[1];
      if (fallback) ensure(fallback);
    }
  }
  return [...files.values()];
}

function codexMessage(event) {
  const role = messageRole(event);
  const content = typeof event?.message === "string" && event.message.trim()
    ? event.message
    : String(event?.detail ?? "").trim();
  if (!role || !content) return null;
  return {
    ...event,
    key: `codex-message:${event.key ?? event.id ?? event.line}`,
    presentation: "codex",
    kind: "message",
    role,
    content,
  };
}

function codexEdits(events) {
  if (!events.length) return null;
  const files = patchFiles(events);
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const removals = files.reduce((total, file) => total + file.removals, 0);
  const first = events[0];
  return {
    key: `codex-edits:${first.key ?? first.id ?? first.line}`,
    presentation: "codex",
    kind: "edits",
    files,
    additions,
    removals,
    count: files.length || events.length,
  };
}

function codexWorked(startedAt, completedAt, key) {
  if (startedAt === null || completedAt === null || completedAt < startedAt) return null;
  return {
    key: `codex-worked:${key}`,
    presentation: "codex",
    kind: "worked",
    label: `Worked for ${durationLabel(completedAt - startedAt)}`,
  };
}

export function multiMonitorConversationItems(payload) {
  if (!object(payload) || !object(payload.raw) || !Array.isArray(payload.raw.completed)) return [];
  const events = [...payload.raw.completed].reverse();
  const items = [];
  let turn = null;

  const appendTurn = (completedEvent = null) => {
    if (!turn) return;
    const worked = codexWorked(
      turn.startedAt,
      eventTime(completedEvent),
      completedEvent?.key ?? completedEvent?.id ?? turn.key,
    );
    const finalIndex = turn.messages.findIndex((item) => item.phase === "final_answer");
    if (worked) turn.messages.splice(finalIndex < 0 ? turn.messages.length : finalIndex, 0, worked);
    items.push(...turn.messages);
    const edits = codexEdits(turn.diffs);
    if (edits) items.push(edits);
    turn = null;
  };

  for (const event of events) {
    const subtype = String(event?.eventType ?? "").split("/").at(-1);
    if (subtype === "task_started") {
      appendTurn();
      turn = {
        key: event.key ?? event.id ?? event.line,
        startedAt: eventTime(event),
        messages: [],
        diffs: [],
      };
      continue;
    }
    if (subtype === "task_complete") {
      appendTurn(event);
      continue;
    }
    const message = codexMessage(event);
    if (message) {
      if (turn) turn.messages.push(message);
      else items.push(message);
      continue;
    }
    if (event?.category === "diff") {
      if (turn) turn.diffs.push(event);
      else {
        const edits = codexEdits([event]);
        if (edits) items.push(edits);
      }
    }
  }
  appendTurn();
  return items;
}

export function multiMonitorConversationPayload(payload) {
  if (!object(payload) || !object(payload.raw) || !Array.isArray(payload.raw.completed)) return payload;
  const completed = multiMonitorConversationItems(payload);
  return {
    ...payload,
    raw: {
      ...payload.raw,
      total: completed.length,
      done: completed.length,
      completed,
    },
  };
}

export function shortThreadSession(value) {
  return typeof value === "string" && value.length > 12 ? `…${value.slice(-8)}` : String(value ?? "");
}
