import { createDiagnostics } from "./diagnostics.mjs";
import { rawSha256 } from "./hash.mjs";

const heading = /^## ([a-z0-9]+(?:-[a-z0-9]+)*)\n$/;
function fenceOpener(line) {
  const found = line.match(/^ {0,3}(`{3,}|~{3,})[^\n]*\n$/);
  return found ? { char: found[1][0], length: found[1].length } : null;
}

function decode(bytes, path, d) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { d.add(path, 0, "E_INSTRUCTIONS_UTF8", "Instructions are not valid UTF-8"); return null; }
}

/** Extract only the exact executable instruction sections selected by Loop agents. */
export function extractInstructionSections(input, ids, { path = "instructions.md" } = {}) {
  const d = createDiagnostics();
  const bytes = Buffer.from(input);
  const source = decode(bytes, path, d);
  if (source === null) return { diagnostics: d.list };
  if (source.includes("\r")) d.add(path, 0, "E_INSTRUCTIONS_CRLF", "Instructions must use LF line endings");
  if (!source.endsWith("\n")) d.add(path, bytes.length, "E_INSTRUCTIONS_FINAL_LF", "Instructions must end in LF");
  const sections = new Map(); let activeFence = null, current = null, currentStart = 0, position = 0;
  for (const line of source.matchAll(/[^\n]*\n|[^\n]+$/g)) {
    const value = line[0], lineOffset = position; position += Buffer.byteLength(value);
    if (activeFence) {
      const close = new RegExp(`^ {0,3}${activeFence.char}{${activeFence.length},} *\\n$`);
      if (close.test(value)) activeFence = null;
      continue;
    }
    const opener = fenceOpener(value);
    if (opener) { activeFence = opener; continue; }
    const found = value.match(heading);
    if (!found) continue;
    if (current) sections.set(current.id, { ...current, bytes: bytes.subarray(currentStart, lineOffset) });
    current = { id: found[1], headingOffset: lineOffset }; currentStart = position;
    if (sections.has(current.id)) d.add(path, lineOffset, "E_INSTRUCTIONS_DUPLICATE", `Duplicate instruction section ${current.id}`);
  }
  if (activeFence) d.add(path, bytes.length, "E_INSTRUCTIONS_FENCE", "Unclosed fenced block");
  if (current) sections.set(current.id, { ...current, bytes: bytes.subarray(currentStart) });
  const selected = [];
  for (const id of [...new Set(ids)].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    const section = sections.get(id);
    if (!section) { d.add(path, 0, "E_INSTRUCTIONS_MISSING", `Missing instruction section ${id}`); continue; }
    if (section.bytes.length < 1 || section.bytes.length > 65536 || !/\S/u.test(new TextDecoder().decode(section.bytes))) {
      d.add(path, section.headingOffset, "E_INSTRUCTIONS_CONTENT", `Instruction section ${id} must contain 1..65536 non-whitespace bytes`); continue;
    }
    selected.push({ id, digest: rawSha256(section.bytes), byteLength: section.bytes.length, bytes: Buffer.from(section.bytes) });
  }
  return { sections: selected, diagnostics: d.list };
}
