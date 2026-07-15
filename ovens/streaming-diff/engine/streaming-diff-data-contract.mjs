export const STREAMING_DIFF_DATA_CONTRACT = "burnlist-streaming-diff-data@2";
export const STREAMING_DIFF_CONTRACT_LIMITS = Object.freeze({ maxRevs: 128, maxFiles: 64, maxCardBytes: 512 * 1024 });

const cardStatuses = new Set(["captured", "partial"]);
const fileKinds = new Set(["modified", "added", "deleted", "binary", "denied", "redacted", "truncated", "unavailable"]);
const textKinds = new Set(["modified", "added", "deleted"]);
const incompleteFileKinds = new Set(["denied", "redacted", "truncated", "unavailable"]);
const opaqueRevision = /^r-[a-f0-9]{16,64}$/u;

export class StreamingDiffDataValidationError extends Error {
  constructor(issues) {
    super(`Streaming Diff data is invalid: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
    this.name = "StreamingDiffDataValidationError";
    this.issues = issues;
    this.status = 422;
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value) {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function repositoryPath(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && !value.startsWith("/")
    && !value.includes("\\")
    && !value.split("/").some((part) => !part || part === "." || part === "..");
}

function validate(value, kind) {
  const issues = [];
  const issue = (path, message) => issues.push({ path, message });
  const keys = (object, path, allowed) => {
    if (!plainObject(object)) return;
    for (const key of Object.keys(object)) if (!allowed.has(key)) issue(`${path}.${key}`, "is not supported by the @2 contract");
  };
  const text = (value, path, max = 2_000) => {
    if (typeof value !== "string" || !value.trim()) issue(path, "must be a non-empty string");
    else if (value.length > max) issue(path, `must be at most ${max} characters`);
  };

  if (!plainObject(value)) {
    issue("$", "must be an object");
    return { ok: false, issues };
  }
  if (kind === "card") {
    keys(value, "$", new Set(["revId", "toolUseId", "ts", "status", "partialReason", "files"]));
    if (typeof value.revId !== "string" || !opaqueRevision.test(value.revId) || /^r-0+$/u.test(value.revId)) issue("$.revId", "must be a random opaque r- hexadecimal id");
    text(value.toolUseId, "$.toolUseId", 256);
    if (!timestamp(value.ts)) issue("$.ts", "must be a parseable timestamp");
    if (!cardStatuses.has(value.status)) issue("$.status", "must be captured or partial");
    if (value.status === "partial") text(value.partialReason, "$.partialReason", 500);
    else if (Object.hasOwn(value, "partialReason")) issue("$.partialReason", "is only allowed when status is partial");
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > STREAMING_DIFF_CONTRACT_LIMITS.maxCardBytes) issue("$", `must serialize to at most ${STREAMING_DIFF_CONTRACT_LIMITS.maxCardBytes} bytes`);
    if (!Array.isArray(value.files)) issue("$.files", "must be an array");
    else {
      if (value.files.length > STREAMING_DIFF_CONTRACT_LIMITS.maxFiles) issue("$.files", `must contain at most ${STREAMING_DIFF_CONTRACT_LIMITS.maxFiles} entries`);
      value.files.forEach((file, index) => {
        const path = `$.files[${index}]`;
        if (!plainObject(file)) {
          issue(path, "must be an object");
          return;
        }
        keys(file, path, new Set(["path", "kind", "diff", "meta"]));
        if (!repositoryPath(file.path)) issue(`${path}.path`, "must be a relative contained repository path");
        if (!fileKinds.has(file.kind)) issue(`${path}.kind`, "is not a supported file kind");
        if (textKinds.has(file.kind) && typeof file.diff !== "string") issue(`${path}.diff`, "is required for a text change");
        if (!textKinds.has(file.kind) && Object.hasOwn(file, "diff")) issue(`${path}.diff`, "is not allowed for a metadata-only file kind");
        if (typeof file.diff === "string" && file.diff.length > 262_144) issue(`${path}.diff`, "must be at most 262144 characters");
        if (Object.hasOwn(file, "meta")) {
          if (!plainObject(file.meta)) issue(`${path}.meta`, "must be an object");
          else {
            keys(file.meta, `${path}.meta`, new Set(["bytes", "reason", "redacted"]));
            if (Object.hasOwn(file.meta, "bytes") && (!Number.isSafeInteger(file.meta.bytes) || file.meta.bytes < 0)) issue(`${path}.meta.bytes`, "must be a non-negative safe integer");
            if (Object.hasOwn(file.meta, "reason")) text(file.meta.reason, `${path}.meta.reason`, 500);
            if (Object.hasOwn(file.meta, "redacted") && file.meta.redacted !== true) issue(`${path}.meta.redacted`, "must be true when present");
          }
        }
        if (file.kind === "redacted") {
          if (!plainObject(file.meta) || file.meta.redacted !== true) issue(`${path}.meta.redacted`, "must be true for a redacted file");
          if (!plainObject(file.meta) || !Object.hasOwn(file.meta, "reason")) issue(`${path}.meta.reason`, "is required for a redacted file");
        }
      });
      if (value.status === "captured" && value.files.some((file) => incompleteFileKinds.has(file?.kind))) {
        issue("$.status", "must be partial when file content is withheld or incomplete");
      }
    }
  } else {
    keys(value, "$", new Set(["contract", "identity", "updatedAt", "revs"]));
    if (value.contract !== STREAMING_DIFF_DATA_CONTRACT) issue("$.contract", `must equal ${STREAMING_DIFF_DATA_CONTRACT}; upgrade or restart this feed`);
    if (!plainObject(value.identity)) issue("$.identity", "must be an object");
    else {
      keys(value.identity, "$.identity", new Set(["logicalRepoKey", "worktreeKey", "session"]));
      for (const key of ["logicalRepoKey", "worktreeKey", "session"]) text(value.identity[key], `$.identity.${key}`, 256);
    }
    if (!timestamp(value.updatedAt)) issue("$.updatedAt", "must be a parseable activity timestamp");
    if (!Array.isArray(value.revs)) issue("$.revs", "must be an ordered array");
    else {
      if (value.revs.length > STREAMING_DIFF_CONTRACT_LIMITS.maxRevs) issue("$.revs", `must contain at most ${STREAMING_DIFF_CONTRACT_LIMITS.maxRevs} revisions`);
      const seen = new Set();
      value.revs.forEach((rev, index) => {
        if (typeof rev !== "string" || !opaqueRevision.test(rev) || /^r-0+$/u.test(rev)) issue(`$.revs[${index}]`, "must be a random opaque r- hexadecimal id");
        else if (seen.has(rev)) issue(`$.revs[${index}]`, "must not repeat a revision id");
        else seen.add(rev);
      });
    }
  }
  return { ok: issues.length === 0, issues };
}

export function validateCard(value) {
  return validate(value, "card");
}

export function validateManifest(value) {
  return validate(value, "manifest");
}

export function assertCard(value) {
  const result = validateCard(value);
  if (!result.ok) throw new StreamingDiffDataValidationError(result.issues);
  return value;
}

export function assertManifest(value) {
  const result = validateManifest(value);
  if (!result.ok) throw new StreamingDiffDataValidationError(result.issues);
  return value;
}
