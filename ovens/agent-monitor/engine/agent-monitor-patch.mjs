export const AGENT_MONITOR_PATCH_LIMITS = Object.freeze({
  maxBytes: 24 * 1024,
  maxLineChars: 600,
  maxLines: 240,
});

function redactSecrets(value) {
  return String(value)
    .replace(/\b((?:proxy-)?authorization)\b(\s*[:=]\s*)((?:bearer|token)\s+)?[^\n]*/giu, "$1$2$3[REDACTED]")
    .replace(/\b(api[_-]?key|key|secret|token|password|passwd)\b(\s*[:=]\s*)[^\n]*/giu, "$1$2[REDACTED]")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|(?:ghp|github_pat|xox[baprs]|AKIA)[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]{8,})\b/giu, "[REDACTED]")
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))\s*=\s*[^\s]+/gu, "$1=[REDACTED]")
    .replace(/(--(?:api-?key|password|secret|token)(?:=|\s+))\S+/giu, "$1[REDACTED]");
}

function sensitivePath(path) {
  return String(path).split("/").some((part) => {
    const name = part.toLowerCase();
    return name === ".git" || name.startsWith(".env")
      || /(?:^|[._-])(?:key|keys|cert|certificate|credential|credentials|secret|secrets|password|token)(?:[._-]|$)/u.test(name)
      || /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/u.test(name)
      || /\.(?:pem|p12|pfx|key|crt)$/u.test(name);
  });
}

function containsSensitiveContent(value) {
  return /-----BEGIN\s+(?:[A-Z ]+\s+)?PRIVATE\s+KEY-----/u.test(String(value));
}

function patchFiles(lines, limit = Number.POSITIVE_INFINITY) {
  const files = [];
  const add = (value) => {
    const quoted = String(value ?? "").trim();
    const file = (quoted.startsWith("\"") && quoted.endsWith("\"") ? quoted.slice(1, -1) : quoted)
      .replace(/^[ab]\//u, "");
    if (file && file !== "/dev/null" && !files.includes(file)) files.push(file);
  };
  for (const line of lines) {
    const custom = /^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/u.exec(line);
    if (custom) add(custom[1]);
    const moved = /^\*\*\* Move to:\s*(.+)$/u.exec(line);
    if (moved) add(moved[1]);
    const unified = /^diff --git (?:a\/)?(.+?) (?:b\/)?(.+)$/u.exec(line);
    if (unified) {
      add(unified[1]);
      add(unified[2]);
    }
    const fileMarker = /^(?:---|\+\+\+)\s+(.+)$/u.exec(line);
    if (fileMarker) add(fileMarker[1]);
    const renamed = /^rename (?:from|to)\s+(.+)$/u.exec(line);
    if (renamed) add(renamed[1]);
    if (files.length >= limit) break;
  }
  return files.slice(0, limit);
}

function textCandidates(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.slice(0, 32).flatMap((item) => textCandidates(item, depth + 1));
  if (typeof value !== "object") return [];
  return ["input", "output", "text", "arguments", "patch"]
    .flatMap((key) => textCandidates(value[key], depth + 1));
}

function patchBody(value) {
  const source = String(value).replace(/\r\n?/gu, "\n");
  const begin = source.indexOf("*** Begin Patch\n");
  if (begin >= 0) {
    const start = begin + "*** Begin Patch\n".length;
    const end = source.indexOf("\n*** End Patch", start);
    return {
      body: source.slice(start, end < 0 ? undefined : end),
      truncated: end < 0 || /(?:warning: )?truncated output/iu.test(source),
    };
  }
  const custom = /(?:^|\n)(?=\*\*\* (?:Add|Update|Delete) File:)/u.exec(source);
  if (custom) {
    const start = custom.index + (source[custom.index] === "\n" ? 1 : 0);
    const end = source.indexOf("\n*** End Patch", start);
    return { body: source.slice(start, end < 0 ? undefined : end), truncated: end < 0 };
  }
  const unified = /(?:^|\n)(?=diff --git )/u.exec(source);
  if (unified) {
    const start = unified.index + (source[unified.index] === "\n" ? 1 : 0);
    return {
      body: source.slice(start),
      truncated: /(?:warning: )?truncated output/iu.test(source),
    };
  }
  const lines = source.split("\n");
  const hasHunk = lines.some((line) => /^@@(?: |$)/u.test(line));
  const firstChange = lines.findIndex((line) => /^[+-](?![+-])/u.test(line));
  if (hasHunk && firstChange >= 0) {
    return {
      body: lines.slice(firstChange).join("\n"),
      truncated: true,
    };
  }
  return null;
}

function decodedStringCandidates(value) {
  const source = String(value).slice(0, 1024 * 1024);
  const candidates = [];
  let count = 0;
  for (const match of source.matchAll(/"(?:\\.|[^"\\])*"/gsu)) {
    if (count >= 96) break;
    count += 1;
    try {
      const decoded = JSON.parse(match[0]);
      if (typeof decoded === "string" && /(?:\*\*\* Begin Patch|diff --git )/u.test(decoded)) {
        candidates.push(decoded);
      }
    } catch { /* malformed JavaScript strings are not patch evidence */ }
  }
  return candidates;
}

function boundedPatch(body, initiallyTruncated) {
  const sourceLines = String(body).split("\n");
  const lines = [];
  let bytes = 0;
  let truncated = initiallyTruncated;
  for (const sourceLine of sourceLines) {
    if (lines.length >= AGENT_MONITOR_PATCH_LIMITS.maxLines) {
      truncated = true;
      break;
    }
    let line = redactSecrets(sourceLine)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "�");
    if (line.length > AGENT_MONITOR_PATCH_LIMITS.maxLineChars) {
      line = `${line.slice(0, AGENT_MONITOR_PATCH_LIMITS.maxLineChars - 1)}…`;
      truncated = true;
    }
    const lineBytes = Buffer.byteLength(line, "utf8") + 1;
    if (bytes + lineBytes > AGENT_MONITOR_PATCH_LIMITS.maxBytes) {
      truncated = true;
      break;
    }
    lines.push(line);
    bytes += lineBytes;
  }
  return lines.length ? { lines, truncated } : null;
}

export function extractAgentMonitorPatch(value) {
  const candidates = textCandidates(value);
  for (const candidate of candidates) {
    const direct = patchBody(candidate);
    if (direct) {
      const paths = patchFiles(direct.body.split("\n"));
      const patch = boundedPatch(direct.body, direct.truncated);
      if (containsSensitiveContent(direct.body) || paths.some(sensitivePath)) return null;
      return patch;
    }
    for (const decoded of decodedStringCandidates(candidate)) {
      const nested = patchBody(decoded);
      if (nested) {
        const paths = patchFiles(nested.body.split("\n"));
        const patch = boundedPatch(nested.body, nested.truncated);
        if (containsSensitiveContent(nested.body) || paths.some(sensitivePath)) return null;
        return patch;
      }
    }
  }
  return null;
}

export function agentMonitorPatchFiles(patch) {
  if (!patch || !Array.isArray(patch.lines)) return [];
  return patchFiles(patch.lines, 8);
}
