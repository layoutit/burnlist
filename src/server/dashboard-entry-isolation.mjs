import { ovenId } from "../ovens/oven-contract.mjs";

const blockedRowPrefix = "\u0000blocked:";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Dashboard row ${field} must be a non-empty string.`);
  return value;
}

function dashboardRowId(value) {
  const id = requiredText(value, "id");
  if (id.startsWith(blockedRowPrefix)) throw new Error("Dashboard row id uses a reserved blocked-row prefix.");
  return id;
}

function nullableText(value, field) {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`Dashboard row ${field} must be a string or null.`);
  return value;
}

function nullableRequiredText(value, field) {
  if (value == null) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`Dashboard row ${field} must be a non-empty string or null.`);
  return value;
}

function count(value, field, { nullable = false } = {}) {
  if (value == null && nullable) return null;
  if (!Number.isInteger(value) || value < 0) throw new Error(`Dashboard row ${field} must be a non-negative integer${nullable ? " or null" : ""}.`);
  return value;
}

function dashboardRow(row, repoKeyForRoot) {
  if (!isRecord(row)) throw new Error("Dashboard handler returned a malformed row.");
  const repoRoot = row.repoRoot == null ? null : requiredText(row.repoRoot, "repoRoot");
  let key = row.repoKey == null ? null : requiredText(row.repoKey, "repoKey");
  if (repoRoot) key = repoKeyForRoot(repoRoot);
  return {
    ...row,
    id: dashboardRowId(row.id),
    repo: requiredText(row.repo, "repo"),
    repoKey: key,
    repoRoot,
    planPath: nullableRequiredText(row.planPath, "planPath"),
    planLabel: nullableRequiredText(row.planLabel, "planLabel"),
    title: requiredText(row.title, "title"),
    status: requiredText(row.status, "status"),
    statusLabel: requiredText(row.statusLabel, "statusLabel"),
    total: count(row.total, "total"),
    done: count(row.done, "done", { nullable: true }),
    remaining: count(row.remaining, "remaining", { nullable: true }),
    percent: count(row.percent, "percent", { nullable: true }),
    errors: count(row.errors, "errors"),
    warnings: count(row.warnings, "warnings"),
    lastCompletedAt: nullableText(row.lastCompletedAt, "lastCompletedAt"),
    updatedAt: nullableText(row.updatedAt, "updatedAt"),
    ovenId: ovenId(row.ovenId),
    ovenName: requiredText(row.ovenName, "ovenName"),
    href: requiredText(row.href, "href"),
    progressLabel: requiredText(row.progressLabel, "progressLabel"),
    ...(row.blockers == null ? {} : { blockers: requiredText(row.blockers, "blockers") }),
  };
}

function blockedRow(blockedEntry, handler, error, handlerIndex, rowIndex) {
  return { ...blockedEntry(handler, error), id: `${blockedRowPrefix}${handlerIndex}:${rowIndex}` };
}

// A handler's call, row normalization, repo key derivation, and sorting share
// isolation boundaries: no malformed adapter result can poison other rows or Ovens.
export function isolatedDashboardEntries({ handlers, contextForHandler, repoKeyForRoot, blockedEntry }) {
  const entries = [];
  for (const [handlerIndex, handler] of handlers.entries()) {
    let rows;
    try {
      rows = handler.dashboardEntries?.(contextForHandler(handler)) ?? [];
      if (!Array.isArray(rows)) throw new Error("Dashboard handler must return an array of rows.");
    } catch (error) {
      entries.push(blockedRow(blockedEntry, handler, error, handlerIndex, -1));
      continue;
    }
    const normalizedRows = [];
    for (const [index, row] of rows.entries()) {
      try {
        normalizedRows.push(dashboardRow(row, repoKeyForRoot));
      } catch (error) {
        normalizedRows.push(blockedRow(blockedEntry, handler, error, handlerIndex, index));
      }
    }
    entries.push(...normalizedRows.sort(
      (left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")),
    ));
  }
  return entries.sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
}
