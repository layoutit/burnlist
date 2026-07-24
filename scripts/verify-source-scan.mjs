const EXCLUDED_PREFIXES = [
  ".git/",
  ".burnlist/",
  ".claude/",
  ".local/",
  ".playwright-cli/",
  ".worktrees/",
  "build/",
  "dist/",
  "node_modules/",
  "notes/burnlists/",
  "output/",
  "research/",
  "website/.astro/",
  "website/dist/",
  "website/node_modules/",
];

export function shouldScanSourceRelativePath(path) {
  const normalized = String(path).replaceAll("\\", "/");
  return !EXCLUDED_PREFIXES.some(
    (prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
  );
}
