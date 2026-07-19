import { diagnostics, nodePath } from "./oven-diagnostics.mjs";

export const XML_LIMITS = Object.freeze({ bytes: 256 * 1024, depth: 64, nodes: 2000, attrs: 64, scalar: 8192 });
const entity = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function point(s, i) { return { offset: Buffer.byteLength(s.slice(0, i)), line: s.slice(0, i).split("\n").length, column: i - s.lastIndexOf("\n", i - 1) }; }
function decode(raw, fail, pos) {
  return raw.replace(/&([^;]*);/g, (whole, name) => {
    if (Object.hasOwn(entity, name)) return entity[name];
    fail("XML_ENTITY", `Only predefined XML entities are allowed (${whole})`, pos);
    return "";
  });
}
function nameOk(name) { return /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name); }

/** Strict, deliberately small XML scanner. It accepts only element trees plus comments. */
export function scanXml(input, { file = "<oven>", limits = XML_LIMITS } = {}) {
  const d = diagnostics(file);
  const warnings = [];
  let source;
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try { source = decoder.decode(input); } catch { d.add("XML_UTF8", "Input is not valid UTF-8"); return { ok: false, diagnostics: d.list }; }
  } else source = String(input);
  const bytes = Buffer.byteLength(source);
  if (bytes > limits.bytes) d.add("XML_LIMIT", `File exceeds ${limits.bytes} byte limit`);
  if (source.includes("\0")) d.add("XML_NUL", "NUL is not allowed");
  let i = 0, root = null, count = 0, fatal = false;
  const stack = [], extensionPrefixes = new Set();
  const fail = (code, message, at = i) => { d.add(code, message, { ...point(source, at), path: stack.length ? nodePath(stack.at(-1)) : "" }); fatal = true; };
  const ws = () => { while (/\s/.test(source[i] ?? "")) i++; };
  const readName = () => { const start = i; while (/[A-Za-z0-9_.:-]/.test(source[i] ?? "")) i++; return source.slice(start, i); };
  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue; }
    if (source.startsWith("<!--", i)) { const end = source.indexOf("-->", i + 4); if (end < 0) { fail("XML_COMMENT", "Unterminated comment"); break; } i = end + 3; continue; }
    if (source[i] !== "<") { fail("XML_TEXT", "Mixed or free text is not allowed"); while (i < source.length && source[i] !== "<") i++; continue; }
    if (/^<(?:!DOCTYPE|!ENTITY|\? |\?|!\[CDATA\[)/i.test(source.slice(i))) { fail("XML_FORBIDDEN", "DOCTYPE, entities, processing instructions, and CDATA are not allowed"); const end = source.indexOf(">", i + 1); i = end < 0 ? source.length : end + 1; continue; }
    const start = i++;
    if (source[i] === "/") {
      i++; const name = readName(); ws();
      if (source[i++] !== ">") fail("XML_END_TAG", "Malformed end tag", start);
      const open = stack.pop();
      if (!open || open.name !== name) fail("XML_MISMATCH", `End tag </${name}> does not match`, start);
      continue;
    }
    const name = readName();
    if (!name || !nameOk(name)) { fail("XML_NAME", "Invalid element name", start); i++; continue; }
    const attrs = Object.create(null), attrSpans = Object.create(null); let selfClosing = false, attrCount = 0;
    while (i < source.length) {
      ws(); if (source.startsWith("/>", i)) { i += 2; selfClosing = true; break; }
      if (source[i] === ">") { i++; break; }
      const at = i, key = readName();
      if (!key || !nameOk(key)) { fail("XML_ATTRIBUTE", "Invalid attribute name", at); i++; continue; }
      if (Object.hasOwn(attrs, key)) fail("XML_DUPLICATE_ATTRIBUTE", `Duplicate attribute ${key}`, at);
      ws(); if (source[i++] !== "=") { fail("XML_ATTRIBUTE", `Expected = after ${key}`, at); continue; } ws();
      const quote = source[i++]; if (quote !== '"' && quote !== "'") { fail("XML_ATTRIBUTE", "Attributes must be quoted", at); continue; }
      const valueStart = i; while (i < source.length && source[i] !== quote) { if (source[i] === "<") fail("XML_ATTRIBUTE", "< is not allowed in attribute values", i); i++; }
      if (i >= source.length) { fail("XML_ATTRIBUTE", "Unterminated attribute value", at); break; }
      const raw = source.slice(valueStart, i++); if (raw.length > limits.scalar) fail("XML_LIMIT", "Attribute value exceeds scalar limit", at);
      const value = decode(raw, fail, at);
      if (key.startsWith("xmlns:")) {
        if (!value.startsWith("urn:burnlist:oven:extension:")) fail("XML_NAMESPACE", "Only oven extension namespaces are allowed", at);
        else extensionPrefixes.add(key.slice(6));
      } else if (key.includes(":")) fail("XML_NAMESPACE", "Namespaced attributes are not allowed", at);
      else { attrs[key] = value; attrSpans[key] = point(source, at); }
      if (++attrCount > limits.attrs) fail("XML_LIMIT", "Too many attributes", at);
    }
    if (++count > limits.nodes) fail("XML_LIMIT", "Too many nodes", start);
    const prefix = name.includes(":") ? name.split(":", 1)[0] : "";
    const extension = prefix && extensionPrefixes.has(prefix);
    if (prefix && !extension) fail("XML_NAMESPACE", "Namespaces are not allowed except optional extension subtrees", start);
    if (extension && attrs.optional !== "true") fail("XML_EXTENSION", "Extension subtrees must be optional=true", start);
    const node = { name, attrs, attrSpans, children: [], span: point(source, start), parent: stack.at(-1), ignored: extension || stack.at(-1)?.ignored };
    node.path = nodePath(node);
    if (!node.ignored) { if (stack.length) stack.at(-1).children.push(node); else if (root) fail("XML_TRAILING", "Only one root element is allowed", start); else root = node; }
    if (extension) warnings.push({ code: "XML_EXTENSION_IGNORED", message: `Ignored optional extension subtree <${name}>`, file, line: node.span.line, column: node.span.column, path: node.path });
    if (!selfClosing) { stack.push(node); if (stack.length > limits.depth) fail("XML_LIMIT", "Maximum nesting depth exceeded", start); }
  }
  if (stack.length) fail("XML_UNCLOSED", `Unclosed element <${stack.at(-1).name}>`, source.length);
  if (!root) fail("XML_ROOT", "Document requires a root element");
  const strip = (node) => { if (!node) return; delete node.parent; delete node.ignored; for (const child of node.children) strip(child); };
  strip(root);
  return d.list.length || fatal ? { ok: false, diagnostics: d.list, ast: root, warnings } : { ok: true, ast: root, diagnostics: [], warnings };
}
