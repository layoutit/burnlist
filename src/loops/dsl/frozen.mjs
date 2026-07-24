import { canonicalIrBytes } from "./canonical.mjs";
import { prefixed, rawSha256 } from "./hash.mjs";
import { validateClosedIr } from "./ir-validate.mjs";

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const digest = /^[a-f0-9]{64}$/;
const sections = ["schema", "compiler", "revisions", "source", "package", "ir", "instructions"];
const revisionKeys = ["source", "package", "executable"];
const packageSizes = { "review.loop": [1, 65536], "instructions.md": [1, 262144], "example/item.md": [0, 65536] };

function sortByPath(entries) {
  return [...entries].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
}

function canonicalInstruction(item) {
  return { id: item.id, digest: item.digest, bytes: item.bytes };
}

function hasOrderedKeys(value, keys) {
  if (!exact(value, keys)) return false;
  return Object.keys(value).length === keys.length && Object.keys(value).every((key, index) => key === keys[index]);
}

function canonicalFrozenBytes(value) {
  if (!exact(value, sections) || !hasOrderedKeys(value, sections) || !exact(value.revisions, revisionKeys) || !hasOrderedKeys(value.revisions, revisionKeys)) return null;
  const ir = JSON.parse(canonicalIrBytes(value.ir).toString("utf8"));
  const packageFiles = sortByPath(value.package).map((entry) => ({ path: entry.path, bytes: entry.bytes }));
  const instructions = [...value.instructions].sort((left, right) => Buffer.compare(Buffer.from(left.id), Buffer.from(right.id))
  ).map((item) => canonicalInstruction(item));
  return Buffer.from(`${JSON.stringify({
    schema: value.schema,
    compiler: value.compiler,
    revisions: { source: value.revisions.source, package: value.revisions.package, executable: value.revisions.executable },
    source: value.source,
    package: packageFiles,
    ir,
    instructions,
  })}\n`, "utf8");
}

function exact(value, keys) { return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function base64(value) { if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new TypeError("Frozen recipe contains noncanonical base64"); const bytes = Buffer.from(value, "base64"); if (bytes.toString("base64") !== value) throw new TypeError("Frozen recipe contains noncanonical base64"); return bytes; }
function revision(value, prefix) { return typeof value === "string" && new RegExp(`^${prefix}-sha256:[a-f0-9]{64}$`).test(value); }
function freeze(value) { if (!value || typeof value !== "object") return value; for (const item of Object.values(value)) freeze(item); return Object.freeze(value); }

/** Serializes the only runtime-facing compiler product: immutable IR and source/package bytes. */
export function freezeRecipe(compiled) {
  if (!compiled?.ok || !compiled.ir || !Buffer.isBuffer(compiled.irBytes) || !compiled.packageFiles) throw new TypeError("A successful compile result is required");
  const packageFiles = Object.entries(compiled.packageFiles).sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right))).map(([path, bytes]) => ({ path, bytes: Buffer.from(bytes).toString("base64") }));
  const instructions = compiled.instructions.map((section) => ({ id: section.id, digest: section.digest, bytes: Buffer.from(section.bytes).toString("base64") }));
  return Buffer.from(`${JSON.stringify({ schema: "burnlist-loop-frozen@1", compiler: compiled.ir.compiler, revisions: compiled.revisions, source: Buffer.from(compiled.packageFiles["review.loop"]).toString("base64"), package: packageFiles, ir: JSON.parse(compiled.irBytes), instructions })}\n`, "utf8");
}

/** Runtime/replay boundary: verify frozen bytes and never recompile installed source. */
export function loadFrozenRecipe(bytes) {
  let value; const raw = Buffer.from(bytes);
  try { value = JSON.parse(raw.toString("utf8")); } catch { throw new TypeError("Frozen recipe is not valid JSON"); }
  try {
    const canonical = canonicalFrozenBytes(value);
    if (!canonical.equals(raw)) throw new TypeError("Frozen recipe is not canonical");
  } catch {
    throw new TypeError("Frozen recipe is not canonical");
  }
  if (!exact(value, sections) || value.schema !== "burnlist-loop-frozen@1" || value.compiler !== "burnlist-loop-compiler@1" || !exact(value.revisions, revisionKeys) || !revision(value.revisions.source, "ls1") || !revision(value.revisions.package, "lp1") || !revision(value.revisions.executable, "er1") || !validateClosedIr(value.ir) || value.ir.compiler !== value.compiler) throw new TypeError("Frozen recipe has an invalid envelope");
  const source = base64(value.source);
  if (!Array.isArray(value.package) || value.package.length < 2 || value.package.length > 3 || !Array.isArray(value.instructions)) throw new TypeError("Frozen recipe has an invalid package");
  const packageFiles = value.package.map((item) => { if (!exact(item, ["path", "bytes"]) || !Object.hasOwn(packageSizes, item.path)) throw new TypeError("Frozen recipe has an invalid package"); const content = base64(item.bytes), [minimum, maximum] = packageSizes[item.path]; if (content.length < minimum || content.length > maximum) throw new TypeError("Frozen recipe has an invalid package"); return { path: item.path, bytes: content }; });
  if (new Set(packageFiles.map((item) => item.path)).size !== packageFiles.length || packageFiles.reduce((total, item) => total + item.bytes.length, 0) > 393216 || !packageFiles.some((item) => item.path === "review.loop" && item.bytes.equals(source)) || !packageFiles.some((item) => item.path === "instructions.md")) throw new TypeError("Frozen recipe has an invalid package");
  const sortedPackage = [...packageFiles].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  const packageDigest = prefixed("lp1-sha256:", "package-v1", sortedPackage.flatMap((item) => [Buffer.from(item.path), item.bytes]));
  if (prefixed("ls1-sha256:", "source-v1", [source]) !== value.revisions.source || packageDigest !== value.revisions.package) throw new TypeError("Frozen recipe provenance revision does not match bytes");
  const parsedInstructions = value.instructions.map((item) => { if (!exact(item, ["id", "digest", "bytes"]) || !slug.test(item.id) || !/^sha256:[a-f0-9]{64}$/.test(item.digest)) throw new TypeError("Frozen recipe instruction is invalid"); const content = base64(item.bytes); if (rawSha256(content) !== item.digest) throw new TypeError("Frozen recipe instruction is invalid"); return { id: item.id, digest: item.digest, byteLength: content.length, base64: item.bytes, content }; });
  if (new Set(parsedInstructions.map((item) => item.id)).size !== parsedInstructions.length) throw new TypeError("Frozen recipe instruction is invalid");
  const irBytes = canonicalIrBytes(value.ir);
  if (JSON.stringify(value.ir.instructions) !== JSON.stringify(parsedInstructions.map(({ content, base64: _base64, ...item }) => item))) throw new TypeError("Frozen recipe instructions do not match IR");
  const executable = prefixed("er1-sha256:", "recipe-v1", [Buffer.from(value.ir.compiler), irBytes, ...parsedInstructions.flatMap((item) => [Buffer.from(item.id), item.content])]);
  if (executable !== value.revisions.executable) throw new TypeError("Frozen recipe executable revision does not match bytes");
  const instructions = parsedInstructions.map(({ content: _content, ...item }) => freeze(item));
  return freeze({ ir: value.ir, irBytes: irBytes.toString("base64"), instructions, revisions: { ...value.revisions } });
}
