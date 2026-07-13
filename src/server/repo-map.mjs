import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, normalize, resolve } from "node:path";
import { Worker } from "node:worker_threads";

export const REPO_MAP_SCHEMA = "burnlist-repo-map@1";

const MAX_FILES = 900;
const MAX_EDGES = 5_000;
const MAX_IMPORT_FILE_BYTES = 1_250_000;
const MAX_IMPORT_TOTAL_BYTES = 24_000_000;
const MAX_LINE_FILE_BYTES = 1_500_000;
const MAX_LINE_TOTAL_BYTES = 40_000_000;
const RECENT_EDIT_MS = 30 * 60 * 1000;
const GIT_TIMEOUT_MS = 2_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

const EXCLUDED_PARTS = new Set([
  ".git",
  ".local",
  ".next",
  ".netlify",
  ".yarn",
  "bower_components",
  "build",
  "coverage",
  "dist",
  "eject",
  "node_modules",
  "out",
]);
const EXCLUDED_FILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
const IMPORT_EXTENSIONS = [".mjs", ".js", ".cjs", ".ts", ".tsx", ".jsx", ".mts", ".cts", ".json"];
const IMPORT_SOURCE_ALIASES = [
  [".js", [".ts", ".tsx", ".jsx"]],
  [".jsx", [".tsx"]],
];
const IMPORT_PATTERN = /\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/gu;
const LINE_EXTENSIONS = new Set([
  ".astro", ".bash", ".c", ".cc", ".cjs", ".cpp", ".cs", ".css", ".cts",
  ".go", ".graphql", ".h", ".hpp", ".htm", ".html", ".java", ".js", ".json",
  ".jsonl", ".jsx", ".kt", ".kts", ".less", ".mjs", ".md", ".mdx", ".mts",
  ".php", ".py", ".rb", ".rs", ".sass", ".scss", ".sh", ".sql", ".svelte",
  ".toml", ".ts", ".tsx", ".txt", ".vue", ".xml", ".yaml", ".yml", ".zsh",
]);
const LINE_FILENAMES = new Set([".env", ".env.example", ".gitignore", ".npmrc", "dockerfile", "makefile"]);

function safeStat(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function normalizeRepoPath(value) {
  return normalize(String(value ?? "")).replaceAll("\\", "/").replace(/^\.\//u, "");
}

function runGit(repoRoot, gitArgs) {
  const result = spawnSync("git", gitArgs, {
    cwd: repoRoot,
    encoding: "buffer",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    shell: false,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message
      ?? result.stderr?.toString("utf8").trim()
      ?? `git ${gitArgs[0]} failed`;
    throw new Error(detail || `git ${gitArgs[0]} failed`);
  }
  return result.stdout.toString("utf8");
}

function nulPaths(repoRoot, gitArgs) {
  return runGit(repoRoot, gitArgs)
    .split("\0")
    .map(normalizeRepoPath)
    .filter(Boolean);
}

function simpleIgnoredDirectoryParts(repoRoot) {
  let text = "";
  try {
    text = readFileSync(resolve(repoRoot, ".gitignore"), "utf8");
  } catch {
    return new Set();
  }
  return new Set(text
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!") && line.endsWith("/"))
    .map((line) => line.replace(/^\/+|\/+$/gu, ""))
    .filter((line) => line && !line.includes("*") && !line.includes("/") && !line.includes("!")));
}

function shouldExcludePath(path, ignoredParts) {
  const parts = normalizeRepoPath(path).split("/").filter(Boolean);
  if (parts.length === 0 || EXCLUDED_FILES.has(parts.at(-1))) return true;
  return parts.some((part) => EXCLUDED_PARTS.has(part) || ignoredParts.has(part));
}

function existingFilePaths(repoRoot, paths, ignoredParts) {
  return [...new Set(paths)]
    .filter((path) => !shouldExcludePath(path, ignoredParts))
    .filter((path) => safeStat(resolve(repoRoot, path))?.isFile())
    .sort((left, right) => left.localeCompare(right));
}

function selectedPaths(paths, dirtyPaths) {
  return [...paths]
    .sort((left, right) => {
      const dirtyDelta = Number(dirtyPaths.has(right)) - Number(dirtyPaths.has(left));
      return dirtyDelta || left.localeCompare(right);
    })
    .slice(0, MAX_FILES);
}

function shouldCountLines(path) {
  const name = basename(path).toLowerCase();
  if (LINE_FILENAMES.has(name)) return true;
  const dot = name.lastIndexOf(".");
  return dot >= 0 && LINE_EXTENSIONS.has(name.slice(dot));
}

function lineCount(repoRoot, path, stat, state) {
  if (state.cache.has(path)) return state.cache.get(path);
  let lines = null;
  if (
    stat?.isFile()
    && stat.size <= MAX_LINE_FILE_BYTES
    && state.bytesRead + stat.size <= MAX_LINE_TOTAL_BYTES
    && shouldCountLines(path)
  ) {
    state.bytesRead += stat.size;
    try {
      const bytes = readFileSync(resolve(repoRoot, path));
      if (!bytes.includes(0)) {
        let newlines = 0;
        for (const byte of bytes) if (byte === 10) newlines += 1;
        lines = bytes.length === 0 ? 0 : newlines + (bytes.at(-1) === 10 ? 0 : 1);
      }
    } catch {
      lines = null;
    }
  }
  state.cache.set(path, lines);
  return lines;
}

function fileEntry(repoRoot, path, { dirtyPaths, untrackedPaths, nowMs, lineState }) {
  const stat = safeStat(resolve(repoRoot, path));
  const mtimeMs = stat?.mtimeMs ?? null;
  const untracked = untrackedPaths.has(path);
  const dirty = untracked || dirtyPaths.has(path);
  return {
    path,
    size: stat?.isFile() ? Math.max(1, Math.min(stat.size, 1_000_000)) : 1,
    lines: lineCount(repoRoot, path, stat, lineState),
    dirty,
    active: false,
    recentlyEdited: Number.isFinite(mtimeMs) && nowMs - mtimeMs <= RECENT_EDIT_MS,
    mtime: Number.isFinite(mtimeMs) ? new Date(mtimeMs).toISOString() : null,
    status: untracked ? "??" : dirty ? "M" : "",
    untracked,
  };
}

function importCandidates(fromPath, specifier) {
  const cleanSpecifier = String(specifier ?? "").split(/[?#]/u)[0];
  if (!cleanSpecifier.startsWith(".")) return [];
  const base = normalizeRepoPath(join(dirname(fromPath), cleanSpecifier));
  if (!base || base === ".." || base.startsWith("../")) return [];
  const candidates = [base];
  for (const [runtimeExtension, sourceExtensions] of IMPORT_SOURCE_ALIASES) {
    if (!base.endsWith(runtimeExtension)) continue;
    const stem = base.slice(0, -runtimeExtension.length);
    for (const extension of sourceExtensions) candidates.push(`${stem}${extension}`);
  }
  if (!IMPORT_EXTENSIONS.some((extension) => base.endsWith(extension))) {
    for (const extension of IMPORT_EXTENSIONS) candidates.push(`${base}${extension}`);
    for (const extension of IMPORT_EXTENSIONS) candidates.push(`${base}/index${extension}`);
  }
  return [...new Set(candidates)];
}

function importEdges(repoRoot, files, allPaths) {
  const visiblePaths = new Set(files.map((file) => file.path));
  const candidates = [];
  let bytesRead = 0;
  let scannedFiles = 0;
  let skippedLargeFiles = 0;
  let skippedBudgetFiles = 0;
  let relativeSpecifiers = 0;
  let unresolvedRelativeSpecifiers = 0;

  for (const file of files) {
    const source = file.path;
    if (!IMPORT_EXTENSIONS.some((extension) => source.endsWith(extension))) continue;
    const stat = safeStat(resolve(repoRoot, source));
    if (!stat?.isFile()) continue;
    if (stat.size > MAX_IMPORT_FILE_BYTES) {
      skippedLargeFiles += 1;
      continue;
    }
    if (bytesRead + stat.size > MAX_IMPORT_TOTAL_BYTES) {
      skippedBudgetFiles += 1;
      continue;
    }
    let text;
    try {
      text = readFileSync(resolve(repoRoot, source), "utf8");
    } catch {
      continue;
    }
    bytesRead += stat.size;
    scannedFiles += 1;
    IMPORT_PATTERN.lastIndex = 0;
    for (const match of text.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? "";
      if (!specifier.startsWith(".")) continue;
      relativeSpecifiers += 1;
      const target = importCandidates(source, specifier)
        .find((candidate) => allPaths.has(candidate) && visiblePaths.has(candidate));
      if (!target) {
        unresolvedRelativeSpecifiers += 1;
        continue;
      }
      candidates.push({
        source,
        target,
        type: "import",
        score: 1 + (file.dirty ? 3 : 0) + (files.find((entry) => entry.path === target)?.dirty ? 3 : 0),
      });
    }
  }

  const byKey = new Map();
  for (const edge of candidates) {
    const key = `${edge.source}\0${edge.target}`;
    const previous = byKey.get(key);
    if (!previous || edge.score > previous.score) byKey.set(key, edge);
  }
  const ranked = [...byKey.values()]
    .sort((left, right) => right.score - left.score || left.source.localeCompare(right.source) || left.target.localeCompare(right.target));
  const all = ranked
    .slice(0, MAX_EDGES)
    .map(({ source, target, type }) => ({ source, target, type }));
  return {
    all,
    stats: {
      scannedFiles,
      skippedLargeFiles,
      skippedBudgetFiles,
      bytesRead,
      relativeSpecifiers,
      unresolvedRelativeSpecifiers,
      resolvedEdges: all.length,
      availableResolvedEdges: byKey.size,
      truncatedEdges: all.length < byKey.size,
      bounded: skippedLargeFiles > 0 || skippedBudgetFiles > 0 || all.length < byKey.size,
    },
  };
}

export function buildRepoMap({ repoRoot, repoName = basename(repoRoot), now = Date.now() } = {}) {
  const root = resolve(String(repoRoot ?? ""));
  const canonicalRoot = realpathSync(root);
  const gitRoot = realpathSync(resolve(runGit(root, ["rev-parse", "--show-toplevel"]).trim()));
  if (gitRoot !== canonicalRoot) throw new Error("Selected repository root does not match git rev-parse.");

  const ignoredParts = simpleIgnoredDirectoryParts(root);
  const trackedRaw = nulPaths(root, ["ls-files", "-z", "--cached"]);
  const untrackedRaw = nulPaths(root, ["ls-files", "-z", "--others", "--exclude-standard"]);
  const changedRaw = [
    ...nulPaths(root, ["diff", "--name-only", "-z", "--"]),
    ...nulPaths(root, ["diff", "--cached", "--name-only", "-z", "--"]),
  ];
  const trackedPaths = existingFilePaths(root, trackedRaw, ignoredParts);
  const untrackedPaths = existingFilePaths(root, untrackedRaw, ignoredParts);
  const workingPaths = [...new Set([...trackedPaths, ...untrackedPaths])].sort((left, right) => left.localeCompare(right));
  const dirtyPaths = new Set(changedRaw.filter((path) => workingPaths.includes(path)));
  const untrackedSet = new Set(untrackedPaths);
  for (const path of untrackedSet) dirtyPaths.add(path);

  const lineState = { bytesRead: 0, cache: new Map() };
  const fileOptions = { dirtyPaths, untrackedPaths: untrackedSet, nowMs: Number(now), lineState };
  const workingFiles = selectedPaths(workingPaths, dirtyPaths).map((path) => fileEntry(root, path, fileOptions));
  const workingEdges = importEdges(root, workingFiles, new Set(workingPaths));

  return {
    schema: REPO_MAP_SCHEMA,
    generatedAt: new Date(Number(now)).toISOString(),
    available: true,
    source: "burnlist-read-only-repo-map",
    repo: String(repoName),
    repoRoot: root,
    error: null,
    totalFiles: workingPaths.length,
    shownFiles: workingFiles.length,
    omittedFiles: Math.max(0, workingPaths.length - workingFiles.length),
    untrackedFiles: untrackedPaths.length,
    dirtyFiles: dirtyPaths.size,
    workingFiles,
    workingAllEdges: workingEdges.all,
    importScan: workingEdges.stats,
  };
}

export function buildRepoMapAsync(options) {
  return new Promise((resolveMap, rejectMap) => {
    const worker = new Worker(new URL("./repo-map-worker.mjs", import.meta.url), { workerData: options });
    worker.once("message", (message) => {
      if (message?.ok) resolveMap(message.value);
      else rejectMap(new Error(message?.error || "Repository map worker failed."));
    });
    worker.once("error", rejectMap);
    worker.once("exit", (code) => {
      if (code !== 0) rejectMap(new Error(`Repository map worker exited with code ${code}.`));
    });
  });
}
