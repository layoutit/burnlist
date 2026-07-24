import { prefixed } from "../dsl/hash.mjs";

const AS = /^as1-sha256:[a-f0-9]{64}$/u;
const ER = /^er1-sha256:[a-f0-9]{64}$/u;
const LP = /^lp1-sha256:[a-f0-9]{64}$/u;
const ITEM_START = /^- \[ \] ([A-Za-z0-9][A-Za-z0-9._-]{0,63}) \|/u;
const BOUNDARY = /^(?:- \[[ xX]\] |## Completed$)/u;
const FIELDS = ["Assignment-Id", "Selector", "Execution-Revision", "Package-Revision"];

function fail(message) { throw new Error(`Loop assignment: ${message}`); }
function digest(prefix, domain, fields) { return prefixed(prefix, domain, fields); }
function linesWithOffsets(bytes) {
  const lines = []; let start = 0;
  for (let index = 0; index < bytes.length; index += 1) if (bytes[index] === 10) {
    lines.push({ start, end: index + 1, text: bytes.subarray(start, index).toString("utf8") }); start = index + 1;
  }
  if (start !== bytes.length) fail("burnlist and item spans must end with LF");
  return lines;
}

export function itemDigest(itemRef, span) {
  return digest("id1-sha256:", "item-v1", [Buffer.from(itemRef), Buffer.from(span)]);
}
export function assignmentDigest(itemRef, unassigned, selector, executable) {
  return digest("as1-sha256:", "assignment-v1", [Buffer.from(itemRef), Buffer.from(unassigned), Buffer.from(selector), Buffer.from(executable)]);
}

/** Return exact byte spans; blank and legacy content remains within its item. */
export function locateItemSpan(markdown, itemId) {
  const bytes = Buffer.isBuffer(markdown) ? Buffer.from(markdown) : Buffer.from(String(markdown), "utf8");
  const lines = linesWithOffsets(bytes); let start = -1; let matches = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const match = ITEM_START.exec(lines[index].text);
    if (match?.[1] === itemId) { start = index; matches += 1; }
  }
  if (start < 0) fail(`active item ${itemId} was not found`);
  if (matches !== 1) fail(`active item ${itemId} is duplicated`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) if (BOUNDARY.test(lines[index].text)) { end = index; break; }
  const startByte = lines[start].start, endByte = end < lines.length ? lines[end].start : bytes.length;
  return { bytes, lines, startLine: start, endLine: end, startByte, endByte, span: bytes.subarray(startByte, endByte) };
}

function metadataAt(lines, index) {
  if (lines[index]?.text !== "  Loop:") return null;
  if (index + 4 >= lines.length) fail("truncated Loop metadata");
  const values = {};
  for (let offset = 0; offset < FIELDS.length; offset += 1) {
    const match = /^    ([A-Za-z-]+): (.*)$/u.exec(lines[index + offset + 1].text);
    if (!match || match[1] !== FIELDS[offset]) fail("noncanonical Loop metadata");
    values[match[1]] = match[2];
  }
  return { line: index, endLine: index + 5, values };
}

export function findLoopMetadata(spanResult) {
  const { lines, startLine, endLine } = spanResult; const markers = [];
  for (let index = startLine; index < endLine; index += 1) if (/^\s*Loop:/u.test(lines[index].text)) markers.push(index);
  if (!markers.length) return null;
  if (markers.length !== 1 || lines[markers[0]].text !== "  Loop:") fail("duplicate or handwritten Loop metadata");
  const meta = metadataAt(lines, markers[0]);
  if (meta.endLine > endLine) fail("Loop metadata escapes item span");
  if (!AS.test(meta.values["Assignment-Id"]) || !ER.test(meta.values["Execution-Revision"]) || !LP.test(meta.values["Package-Revision"])) fail("noncanonical Loop digest");
  if (!/^loop:builtin:[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(meta.values.Selector)) fail("noncanonical Loop selector");
  return meta;
}

function trimBlankSuffix(lines, start, end) {
  let index = end; while (index > start && lines[index - 1].text === "") index -= 1; return index;
}
function block(values) { return Buffer.from(["  Loop:", ...FIELDS.map((field) => `    ${field}: ${values[field]}`)].join("\n") + "\n"); }

export function buildAssignment(itemRef, spanResult, { selector, executable, packageRevision }) {
  if (findLoopMetadata(spanResult)) fail("item is already assigned");
  const unassignedDigest = itemDigest(itemRef, spanResult.span);
  const assignmentId = assignmentDigest(itemRef, unassignedDigest, selector, executable);
  const values = { "Assignment-Id": assignmentId, Selector: selector, "Execution-Revision": executable, "Package-Revision": packageRevision };
  const insertLine = trimBlankSuffix(spanResult.lines, spanResult.startLine, spanResult.endLine);
  const insertAt = insertLine < spanResult.lines.length ? spanResult.lines[insertLine].start : spanResult.endByte;
  const assignedSpan = Buffer.concat([spanResult.span.subarray(0, insertAt - spanResult.startByte), block(values), spanResult.span.subarray(insertAt - spanResult.startByte)]);
  return { values, assignmentId, unassignedDigest, assignedDigest: itemDigest(itemRef, assignedSpan), assignedSpan, insertAt };
}

export function validateAssignedItem(itemRef, spanResult) {
  const meta = findLoopMetadata(spanResult); if (!meta) fail("item has no Loop assignment");
  const metaStart = spanResult.lines[meta.line].start - spanResult.startByte;
  const metaEnd = spanResult.lines[meta.endLine - 1].end - spanResult.startByte;
  const unassigned = Buffer.concat([spanResult.span.subarray(0, metaStart), spanResult.span.subarray(metaEnd)]);
  // The block must follow every nonblank item line and precede only the maximal
  // trailing run of blank LF lines. This also rejects a block moved into prose.
  if (spanResult.lines.slice(meta.endLine, spanResult.endLine).some((line) => line.text !== "")) fail("Loop metadata is not canonically placed");
  const unassignedDigest = itemDigest(itemRef, unassigned);
  const expectedId = assignmentDigest(itemRef, unassignedDigest, meta.values.Selector, meta.values["Execution-Revision"]);
  if (expectedId !== meta.values["Assignment-Id"]) fail("stale or handwritten assignment id");
  return { ...meta.values, unassignedSpan: unassigned, unassignedDigest, assignedDigest: itemDigest(itemRef, spanResult.span), metaStart, metaEnd };
}

export function containsLoopMarker(spanResult) { return spanResult.lines.slice(spanResult.startLine, spanResult.endLine).some((line) => /^\s*Loop:/u.test(line.text)); }
