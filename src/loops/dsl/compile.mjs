import { canonicalIrBytes } from "./canonical.mjs";
import { createDiagnostics, finalizeDiagnostics } from "./diagnostics.mjs";
import { prefixed, rawSha256 } from "./hash.mjs";
import { extractInstructionSections } from "./instructions.mjs";
import { validateClosedIr } from "./ir-validate.mjs";
import { validateLoop } from "./grammar.mjs";
import { parseLoopXml } from "./loop-xml.mjs";
import { readPackageDirectory } from "./package-read.mjs";

const paths = ["review.loop", "instructions.md", "example/item.md"];
const sizes = { "review.loop": [1, 65536], "instructions.md": [1, 262144], "example/item.md": [0, 65536] };
const totalLimit = 393216;

function appendDiagnostics(target, source) {
  for (const item of source) {
    target.add(item.path, item.byteOffset, item.code, item.message);
  }
}

function sourceChecks(bytes, path, d) {
  const [minimum, maximum] = sizes[path];
  if (bytes.length < minimum || bytes.length > maximum) d.add(path, 0, "E_FILE_SIZE", `${path} must contain ${minimum}..${maximum} bytes`);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) d.add(path, 0, "E_FILE_BOM", "UTF-8 BOM is not allowed");
    if (text.includes("\0")) d.add(path, 0, "E_FILE_NUL", "NUL is not allowed");
    if (text.includes("\r")) d.add(path, 0, "E_FILE_CR", "Only LF line endings are allowed");
    if (bytes.length && !text.endsWith("\n")) d.add(path, bytes.length, "E_FILE_FINAL_LF", "Nonempty files must end in LF");
  } catch { d.add(path, 0, "E_FILE_UTF8", "File is not valid UTF-8"); }
}

function collectDiagnostics(...results) { return results.flatMap((result) => result?.allDiagnostics ?? result?.diagnostics ?? []); }

function packageRevision(data) {
  const fields = Object.entries(data).sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right))).flatMap(([path, bytes]) => [Buffer.from(path), bytes]);
  return prefixed("lp1-sha256:", "package-v1", fields);
}

function cloneFiles(data) {
  return Object.fromEntries(Object.entries(data).map(([path, bytes]) => [path, Buffer.from(bytes)]));
}

function compileLoopFilesInternal(files, { continueOnMissing = false } = {}) {
  const d = createDiagnostics();
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    d.add("", 0, "E_PACKAGE", "Package files must be an object");
  }

  const actual = Object.keys(files ?? {});
  if (actual.length > 3) d.add("", 0, "E_PACKAGE_COUNT", "Package may contain at most three files");
  for (const path of actual) if (!paths.includes(path)) d.add(path, 0, "E_PACKAGE_PATH", "Unknown package file");
  for (const path of paths.slice(0, 2)) if (!(path in (files ?? {}))) d.add(path, 0, "E_PACKAGE_MISSING", "Required package file is missing");

  if (!continueOnMissing && d.all.length) return { ok: false, diagnostics: d.all };

  const data = {};
  for (const path of paths) if (path in (files ?? {})) {
    try {
      data[path] = Buffer.from(files[path]);
      sourceChecks(data[path], path, d);
    } catch {
      d.add(path, 0, "E_PACKAGE_BYTES", "Package file must be byte data");
    }
  }

  if (!("review.loop" in data)) return { ok: false, diagnostics: d.all, packageFiles: cloneFiles(data) };
  if (Object.values(data).reduce((sum, bytes) => sum + bytes.length, 0) > totalLimit) d.add("", 0, "E_PACKAGE_SIZE", "Package exceeds 393216 byte limit");
  if (!continueOnMissing && d.all.length) return { ok: false, diagnostics: d.all, packageFiles: cloneFiles(data) };

  const parsed = parseLoopXml(data["review.loop"]);
  const checked = parsed.ast ? validateLoop(parsed.ast) : null;
  appendDiagnostics(d, collectDiagnostics(parsed, checked));

  if (!continueOnMissing && d.all.length) return { ok: false, diagnostics: d.all, packageFiles: cloneFiles(data) };
  if (!checked) return { ok: false, diagnostics: d.all, packageFiles: cloneFiles(data) };

  if (!("instructions.md" in data)) {
    return { ok: false, diagnostics: d.all, packageFiles: cloneFiles(data) };
  }

  const extracted = extractInstructionSections(data["instructions.md"], checked.instructionIds);
  appendDiagnostics(d, extracted.diagnostics);
  if (extracted.diagnostics.length > 0 || !continueOnMissing && d.all.length) {
    return { ok: false, diagnostics: d.all, packageFiles: cloneFiles(data) };
  }

  const ir = { ...checked.ir, instructions: extracted.sections.map(({ bytes, ...section }) => section) };
  if (!validateClosedIr(ir)) {
    d.add("review.loop", 0, "E_IR_INVARIANT", "Closed invariant validation failed");
    return { ok: false, diagnostics: d.all, packageFiles: cloneFiles(data) };
  }

  const irBytes = canonicalIrBytes(ir);
  const revisions = {
    source: prefixed("ls1-sha256:", "source-v1", [data["review.loop"]]),
    package: packageRevision(data),
    executable: prefixed("er1-sha256:", "recipe-v1", [Buffer.from(ir.compiler), irBytes, ...extracted.sections.flatMap((section) => [Buffer.from(section.id), section.bytes])]),
  };

  const packageFiles = Object.fromEntries(Object.entries(data).map(([path, bytes]) => [path, Buffer.from(bytes)]));
  return {
    ok: true,
    ir,
    irBytes,
    instructions: extracted.sections,
    packageFiles,
    revisions,
    rawSourceDigest: rawSha256(data["review.loop"]),
    diagnostics: d.all,
  };
}

export function compileLoopFiles(files) {
  const result = compileLoopFilesInternal(files);
  const finalized = finalizeDiagnostics(result.diagnostics);
  if (finalized.length) return { ok: false, diagnostics: finalized };
  return { ...result, diagnostics: finalized };
}

/**
 * Compile package files directly from a directory without trust or execution.
 */
export async function compileLoopPackage(directory, { beforeLeafRead, afterLeafOpenForTest } = {}) {
  const { files, diagnostics } = await readPackageDirectory(directory, {
    beforeLeafRead,
    afterLeafOpenForTest,
  });
  const compiled = compileLoopFilesInternal(files, { continueOnMissing: true });
  const merged = finalizeDiagnostics([...diagnostics, ...(compiled.diagnostics ?? [])]);
  if (merged.length) return { ok: false, diagnostics: merged };
  return compiled;
}
