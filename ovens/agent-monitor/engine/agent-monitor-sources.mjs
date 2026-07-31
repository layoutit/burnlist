import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

export const AGENT_MONITOR_PROVIDERS = Object.freeze(["codex", "claude", "agy", "grok"]);

const metadataCache = new Map();
const codexRolloutPattern = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/iu;

export function codexRolloutSession(path, fallback = null) {
  return codexRolloutPattern.exec(basename(path))?.[1] ?? fallback;
}

function boundedFile(path, recentAfter, limits) {
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size > 0 && stat.size <= limits.maxFileBytes
      && stat.mtimeMs >= recentAfter
      ? { path, mtimeMs: stat.mtimeMs, size: stat.size }
      : null;
  } catch {
    return null;
  }
}

function walk(root, accept, recentAfter, limits) {
  const files = [];
  const pending = [root];
  let directories = 0;
  while (pending.length && directories < limits.maxDirectories
      && files.length < limits.maxCandidateFiles) {
    const directory = pending.pop();
    directories += 1;
    let entries;
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && accept(path)) {
        const candidate = boundedFile(path, recentAfter, limits);
        if (candidate) files.push(candidate);
      }
      if (files.length >= limits.maxCandidateFiles) break;
    }
  }
  return files;
}

function readPrefix(path, limit) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    const buffer = Buffer.alloc(Math.min(stat.size, limit));
    const bytes = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytes).toString("utf8");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function readSuffix(path, limit) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    const start = Math.max(0, stat.size - limit);
    const buffer = Buffer.alloc(stat.size - start);
    const bytes = readSync(fd, buffer, 0, buffer.length, start);
    let source = buffer.subarray(0, bytes).toString("utf8");
    if (start > 0) {
      const newline = source.indexOf("\n");
      source = newline < 0 ? "" : source.slice(newline + 1);
    }
    return source;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function parseRecords(source, maximum = 256) {
  const value = [];
  for (const line of source.split("\n")) {
    if (!line.trim()) continue;
    try { value.push(JSON.parse(line)); } catch { /* An incomplete tail is not metadata. */ }
  }
  return value.slice(-maximum);
}

function records(path, limits) {
  let stat;
  try { stat = statSync(path); } catch { return []; }
  const cached = metadataCache.get(path);
  if (cached?.size === stat.size && cached?.mtimeMs === stat.mtimeMs) return cached.value;
  const value = [];
  try {
    for (const line of readPrefix(path, limits.metadataBytes).split("\n")) {
      if (!line.trim()) continue;
      try { value.push(JSON.parse(line)); } catch { /* An incomplete tail is not metadata. */ }
      if (value.length >= 32) break;
    }
  } catch { /* An unreadable file is not a discoverable session. */ }
  metadataCache.set(path, { size: stat.size, mtimeMs: stat.mtimeMs, value });
  return value;
}

function recentRecords(path, limits) {
  let stat;
  try { stat = statSync(path); } catch { return []; }
  const cached = metadataCache.get(path);
  if (cached?.size === stat.size && cached?.mtimeMs === stat.mtimeMs && cached.recent) {
    return cached.recent;
  }
  let recent = [];
  try { recent = parseRecords(readSuffix(path, limits.metadataBytes)); } catch { /* unreadable */ }
  metadataCache.set(path, {
    ...(cached?.size === stat.size && cached?.mtimeMs === stat.mtimeMs ? cached : {}),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    recent,
  });
  return recent;
}

function customToolWorkingDirectory(record) {
  const payload = record?.payload;
  if (record?.type === "turn_context" && typeof payload?.cwd === "string") return payload.cwd;
  if (record?.type !== "response_item" || payload?.type !== "custom_tool_call"
      || typeof payload.input !== "string") return null;
  const matches = [...payload.input.matchAll(/\bworkdir\s*:\s*["'](\/[^"'\r\n]+)["']/gu)];
  return matches.at(-1)?.[1] ?? null;
}

function insideGitWorktree(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  let current = resolve(value);
  while (true) {
    try {
      if (statSync(join(current, ".git")).isDirectory()) return true;
    } catch { /* Keep walking toward the filesystem root. */ }
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function codexCurrentWorkingDirectory(path, limits) {
  const find = (values) => values
    .map(customToolWorkingDirectory)
    .filter(insideGitWorktree)
    .at(-1);
  const recent = find(recentRecords(path, limits));
  if (recent) return recent;
  try {
    const deepLimit = Math.min(limits.maxFileBytes, limits.metadataBytes * 8);
    return find(parseRecords(readSuffix(path, deepLimit), 4_096)) ?? null;
  } catch {
    return null;
  }
}

function stringAt(value, keys) {
  if (!value || typeof value !== "object") return null;
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key];
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = stringAt(child, keys);
      if (found) return found;
    }
  }
  return null;
}

function codexMetadata(path, limits) {
  for (const record of records(path, limits)) {
    if (record?.type !== "session_meta") continue;
    const session = record?.payload?.session_id ?? record?.payload?.id;
    const cwd = record?.payload?.cwd;
    if (typeof session === "string" && typeof cwd === "string") {
      const threadSource = ["user", "subagent"].includes(record.payload.thread_source)
        ? record.payload.thread_source
        : "other";
      const currentCwd = codexCurrentWorkingDirectory(path, limits);
      return {
        session: codexRolloutSession(path, session),
        providerSession: session,
        cwd: resolve(currentCwd ?? cwd),
        threadSource,
        topLevel: threadSource === "user"
          && !(typeof record.payload.parent_thread_id === "string"
            && record.payload.parent_thread_id.trim()),
      };
    }
  }
  return null;
}

function claudeMetadata(path, limits) {
  for (const record of records(path, limits)) {
    const cwd = record?.cwd;
    const session = record?.sessionId ?? record?.session_id;
    if (typeof cwd === "string" && typeof session === "string") return { session, cwd: resolve(cwd) };
  }
  return null;
}

function grokMetadata(path) {
  try {
    const encodedCwd = basename(dirname(dirname(path)));
    return {
      cwd: resolve(decodeURIComponent(encodedCwd)),
      session: basename(dirname(path)),
    };
  } catch {
    return null;
  }
}

function agyMetadata(path, limits) {
  const values = records(path, limits);
  const cwd = values.map((record) =>
    stringAt(record, ["cwd", "workspacePath", "workspace_path", "projectPath", "project_path"]))
    .find(Boolean);
  const conversation = values.map((record) =>
    stringAt(record, ["conversationId", "conversation_id", "sessionId", "session_id"]))
    .find(Boolean);
  const inferred = basename(dirname(dirname(dirname(path))));
  return cwd ? { cwd: resolve(cwd), session: conversation ?? inferred } : null;
}

function providerFiles(provider, root, recentAfter, limits) {
  if (provider === "codex") {
    return walk(root, (path) => path.endsWith(".jsonl"), recentAfter, limits);
  }
  if (provider === "claude") {
    return walk(root, (path) => path.endsWith(".jsonl") && !path.includes("/subagents/"), recentAfter, limits);
  }
  if (provider === "grok") {
    return walk(root, (path) => basename(path) === "events.jsonl", recentAfter, limits);
  }
  return walk(root, (path) => basename(path) === "transcript.jsonl", recentAfter, limits);
}

export function defaultAgentMonitorRoots(home = homedir()) {
  return {
    codex: join(home, ".codex", "sessions"),
    claude: join(home, ".claude", "projects"),
    agy: join(home, ".gemini", "antigravity-cli", "brain"),
    grok: join(home, ".grok", "sessions"),
  };
}

function metadata(provider, path, limits) {
  if (provider === "codex") return codexMetadata(path, limits);
  if (provider === "claude") return claudeMetadata(path, limits);
  if (provider === "grok") return grokMetadata(path);
  return agyMetadata(path, limits);
}

export function discoverAgentSessionSources({
  providers = AGENT_MONITOR_PROVIDERS,
  roots = defaultAgentMonitorRoots(),
  sessionRoot,
  nowMs = Date.now(),
  limits,
} = {}) {
  const requested = [...new Set(providers)];
  const invalid = requested.find((provider) => !AGENT_MONITOR_PROVIDERS.includes(provider));
  if (invalid) throw new Error(`Unsupported Agent Monitor provider: ${invalid}`);
  const recentAfter = nowMs - limits.days * 86_400_000;
  const effectiveRoots = { ...roots, ...(sessionRoot ? { codex: sessionRoot } : {}) };
  return requested.flatMap((provider) =>
    providerFiles(provider, effectiveRoots[provider], recentAfter, limits).flatMap((file) => {
      const value = metadata(provider, file.path, limits);
      return value ? [{ ...file, ...value, provider }] : [];
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, limits.maxSessions);
}
