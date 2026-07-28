import { createHash } from "node:crypto";
import { statSync } from "node:fs";

function identity(scope) {
  return scope.flatMap((entry) => [entry.repoKey, entry.root]);
}

function fingerprint(scope, paths) {
  const fields = identity(scope);
  for (const path of paths(scope)) {
    try {
      const stat = statSync(path);
      fields.push(path, String(stat.mtimeMs), String(stat.size));
    } catch {
      fields.push(path, "-");
    }
  }
  return createHash("sha256").update(fields.join("\0")).digest("base64url");
}

export function createFileIndexSnapshot({ scope, paths, build }) {
  if (![scope, paths, build].every((value) => typeof value === "function")) {
    throw new TypeError("File index snapshot requires scope, paths, and build functions.");
  }
  let cached = null;
  return Object.freeze({
    snapshot() {
      const currentScope = scope();
      const revision = fingerprint(currentScope, paths);
      if (cached?.revision === revision) return cached.value;
      const value = build(currentScope);
      cached = { revision, value };
      return value;
    },
  });
}
