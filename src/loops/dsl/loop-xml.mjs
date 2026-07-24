import { createDiagnostics } from "./diagnostics.mjs";

const nameRE = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

function offsetOf(source, index) { return Buffer.byteLength(source.slice(0, index)); }
function white(char) { return char === " " || char === "\t" || char === "\n" || char === "\r"; }

/** Parses the intentionally tiny, element-only Stage 1 XML subset. */
export function parseLoopXml(input, { path = "review.loop" } = {}) {
  const d = createDiagnostics();
  let source;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(input); }
  catch { d.add(path, 0, "E_XML_UTF8", "Source is not valid UTF-8"); return { diagnostics: d.list, allDiagnostics: d.all }; }
  const add = (at, code, message) => d.add(path, offsetOf(source, at), code, message);
  let i = 0, root = null, elements = 0;
  const stack = [];
  const skip = () => { while (white(source[i])) i++; };
  const readName = () => {
    const begin = i; while (/[A-Za-z0-9_.:-]/.test(source[i] ?? "")) i++;
    const value = source.slice(begin, i); return nameRE.test(value) ? value : "";
  };
  const text = () => {
    const begin = i; while (i < source.length && source[i] !== "<") i++;
    if (/\S/.test(source.slice(begin, i))) add(begin, "E_XML_TEXT", "Non-whitespace element text is not allowed");
  };
  while (i < source.length) {
    if (source[i] !== "<") { text(); continue; }
    const begin = i++;
    if (source.startsWith("<!--", begin)) {
      const end = source.indexOf("-->", begin + 4);
      add(begin, "E_XML_COMMENT", end < 0 ? "Comments are not allowed (unterminated)" : "Comments are not allowed");
      i = end < 0 ? source.length : end + 3; continue;
    }
    if (source.startsWith("<!", begin) || source.startsWith("<?", begin)) {
      const end = source.indexOf(">", i); add(begin, "E_XML_FORBIDDEN", "Declarations, entities, CDATA, and processing instructions are not allowed");
      i = end < 0 ? source.length : end + 1; continue;
    }
    if (source[i] === "/") {
      i++; const name = readName(); skip();
      if (!name || source[i] !== ">") { add(begin, "E_XML_END_TAG", "Malformed end tag"); while (i < source.length && source[i] !== ">") i++; }
      if (source[i] === ">") i++;
      const open = stack.pop();
      if (!open || open.name !== name) add(begin, "E_XML_MISMATCH", `End tag </${name || "?"}> does not match its opening element`);
      continue;
    }
    const name = readName();
    if (!name) { add(begin, "E_XML_NAME", "Invalid element name"); while (i < source.length && source[i] !== ">") i++; if (source[i] === ">") i++; continue; }
    if (name.includes(":")) add(begin, "E_XML_NAMESPACE", "Namespaces are not allowed");
    const attrs = Object.create(null); let selfClosing = false;
    while (i < source.length) {
      skip();
      if (source.startsWith("/>", i)) { i += 2; selfClosing = true; break; }
      if (source[i] === ">") { i++; break; }
      const attrAt = i, key = readName();
      if (!key) { add(attrAt, "E_XML_ATTRIBUTE", "Invalid attribute name"); i++; continue; }
      if (key.includes(":")) add(attrAt, "E_XML_NAMESPACE", "Namespaces are not allowed");
      skip(); if (source[i] !== "=") { add(attrAt, "E_XML_ATTRIBUTE", `Expected = after attribute ${key}`); continue; }
      i++; skip(); const quote = source[i++];
      if (quote !== '"' && quote !== "'") { add(attrAt, "E_XML_ATTRIBUTE", "Attribute values must be quoted"); continue; }
      const valueAt = i; while (i < source.length && source[i] !== quote) i++;
      if (i >= source.length) { add(attrAt, "E_XML_ATTRIBUTE", "Unterminated attribute value"); break; }
      const value = source.slice(valueAt, i++);
      if (value.includes("&")) add(valueAt, "E_XML_ENTITY", "Entities are not allowed");
      if (Object.hasOwn(attrs, key)) add(attrAt, "E_XML_DUPLICATE_ATTRIBUTE", `Duplicate attribute ${key}`);
      else attrs[key] = value;
    }
    const node = { name, attrs, children: [], byteOffset: offsetOf(source, begin), selfClosing };
    elements++;
    if (elements > 32) add(begin, "E_XML_LIMIT", "XML element limit is 32");
    if (stack.length >= 2) add(begin, "E_XML_DEPTH", "XML depth limit is 2");
    if (stack.length) stack.at(-1).children.push(node);
    else if (root) add(begin, "E_XML_ROOT", "Only one root element is allowed");
    else root = node;
    if (!selfClosing) stack.push(node);
  }
  for (const node of stack.reverse()) d.add(path, Buffer.byteLength(source), "E_XML_UNCLOSED", `Unclosed element <${node.name}>`);
  if (!root) d.add(path, 0, "E_XML_ROOT", "Document requires a root <loop> element");
  return { ast: root, diagnostics: d.list, allDiagnostics: d.all };
}
