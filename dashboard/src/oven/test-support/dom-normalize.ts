export type ElementNode = {
  type: "element";
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
};

export type TextNode = {
  type: "text";
  value: string;
};

export type Node = ElementNode | TextNode;

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function isWhitespace(value: string): boolean {
  return /\s/u.test(value);
}

export function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|apos);|&#(?:x[0-9a-fA-F]+|X[0-9a-fA-F]+|\d+);/gu, (entity) => {
    switch (entity) {
      case "&amp;": return "&";
      case "&lt;": return "<";
      case "&gt;": return ">";
      case "&quot;": return '"';
      case "&#39;":
      case "&apos;": return "'";
      default: {
        const digits = entity.startsWith("&#x") || entity.startsWith("&#X") ? entity.slice(3, -1) : entity.slice(2, -1);
        const codePoint = Number.parseInt(digits, entity[2].toLowerCase() === "x" ? 16 : 10);
        return codePoint <= 0x10FFFF ? String.fromCodePoint(codePoint) : entity;
      }
    }
  });
}

function findTagEnd(html: string, start: number): number {
  let quote = "";
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

function parseOpenTag(source: string): { tag: string; attrs: Record<string, string>; selfClosing: boolean } | null {
  let cursor = 0;
  while (cursor < source.length && isWhitespace(source[cursor])) cursor += 1;
  const tagStart = cursor;
  while (cursor < source.length && !isWhitespace(source[cursor]) && source[cursor] !== "/") cursor += 1;
  const tag = source.slice(tagStart, cursor);
  if (!tag) return null;

  const attrs: Record<string, string> = {};
  let selfClosing = false;
  while (cursor < source.length) {
    while (cursor < source.length && isWhitespace(source[cursor])) cursor += 1;
    if (cursor >= source.length) break;
    if (source[cursor] === "/") {
      selfClosing = true;
      cursor += 1;
      continue;
    }

    const nameStart = cursor;
    while (cursor < source.length && !isWhitespace(source[cursor]) && !"=/>".includes(source[cursor])) cursor += 1;
    const name = source.slice(nameStart, cursor);
    if (!name) {
      cursor += 1;
      continue;
    }
    while (cursor < source.length && isWhitespace(source[cursor])) cursor += 1;

    let value = "";
    if (source[cursor] === "=") {
      cursor += 1;
      while (cursor < source.length && isWhitespace(source[cursor])) cursor += 1;
      const quote = source[cursor];
      if (quote === "\"" || quote === "'") {
        cursor += 1;
        const valueStart = cursor;
        while (cursor < source.length && source[cursor] !== quote) cursor += 1;
        value = source.slice(valueStart, cursor);
        if (cursor < source.length) cursor += 1;
      } else {
        const valueStart = cursor;
        while (cursor < source.length && !isWhitespace(source[cursor]) && source[cursor] !== ">") {
          if (source[cursor] === "/" && source[cursor + 1] === undefined) break;
          cursor += 1;
        }
        value = source.slice(valueStart, cursor);
      }
    }
    if (!(name in attrs)) attrs[name] = value;
  }

  return { tag, attrs, selfClosing };
}

function appendNode(roots: Node[], stack: ElementNode[], node: Node): void {
  const parent = stack[stack.length - 1];
  if (parent) parent.children.push(node);
  else roots.push(node);
}

export function parseHtml(html: string): Node[] {
  const roots: Node[] = [];
  const stack: ElementNode[] = [];
  let cursor = 0;

  while (cursor < html.length) {
    const open = html.indexOf("<", cursor);
    if (open < 0) {
      if (cursor < html.length) appendNode(roots, stack, { type: "text", value: html.slice(cursor) });
      break;
    }
    if (open > cursor) appendNode(roots, stack, { type: "text", value: html.slice(cursor, open) });

    if (html.startsWith("<!--", open)) {
      const commentEnd = html.indexOf("-->", open + 4);
      cursor = commentEnd < 0 ? html.length : commentEnd + 3;
      continue;
    }

    const tagEnd = findTagEnd(html, open + 1);
    if (tagEnd < 0) {
      appendNode(roots, stack, { type: "text", value: html.slice(open) });
      break;
    }
    const source = html.slice(open + 1, tagEnd);
    if (source.trimStart().startsWith("!")) {
      cursor = tagEnd + 1;
      continue;
    }
    if (source.trimStart().startsWith("/")) {
      const closingTag = source.trim().slice(1).trim().split(/\s/u)[0];
      if (closingTag) {
        for (let index = stack.length - 1; index >= 0; index -= 1) {
          if (stack[index].tag.toLowerCase() === closingTag.toLowerCase()) {
            stack.length = index;
            break;
          }
        }
      }
      cursor = tagEnd + 1;
      continue;
    }

    const parsed = parseOpenTag(source);
    if (!parsed) {
      appendNode(roots, stack, { type: "text", value: html.slice(open, tagEnd + 1) });
      cursor = tagEnd + 1;
      continue;
    }
    const node: ElementNode = { type: "element", tag: parsed.tag, attrs: parsed.attrs, children: [] };
    appendNode(roots, stack, node);
    if (!parsed.selfClosing && !VOID_ELEMENTS.has(parsed.tag.toLowerCase())) stack.push(node);
    cursor = tagEnd + 1;
  }

  return roots;
}

export function normalize(nodes: Node[]): Node[] {
  const normalized: Node[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      const value = decodeEntities(node.value).replace(/\s+/gu, " ").trim();
      if (value) normalized.push({ type: "text", value });
      continue;
    }
    normalized.push({
      type: "element",
      tag: node.tag,
      attrs: Object.fromEntries(Object.entries(node.attrs).map(([name, value]) => [name, decodeEntities(value)])),
      children: normalize(node.children),
    });
  }
  return normalized;
}

function serializeNode(node: Node): string {
  if (node.type === "text") return node.value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const attrs = Object.keys(node.attrs)
    .sort()
    .map((name) => `${name}="${node.attrs[name].replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")}"`)
    .join(" ");
  const opening = attrs ? `<${node.tag} ${attrs}>` : `<${node.tag}>`;
  return `${opening}${serializeCanonical(node.children)}</${node.tag}>`;
}

export function serializeCanonical(nodes: Node[]): string {
  return nodes.map(serializeNode).join("");
}

function truncated(value: string): string {
  const limit = 280;
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function nodeSource(node: Node | undefined): string {
  return node ? truncated(serializeCanonical([node])) : "<missing>";
}

function mismatch(path: string, actual: Node | undefined, expected: Node | undefined): { equal: false; message: string } {
  return {
    equal: false,
    message: `DOM differs at ${path}: actual ${nodeSource(actual)}; expected ${nodeSource(expected)}`,
  };
}

function compareNodes(actual: Node | undefined, expected: Node | undefined, path: string): { equal: true } | { equal: false; message: string } {
  if (!actual || !expected) return mismatch(path, actual, expected);
  if (actual.type !== expected.type) return mismatch(path, actual, expected);
  if (actual.type === "text" && expected.type === "text") {
    return actual.value === expected.value ? { equal: true } : mismatch(path, actual, expected);
  }
  if (actual.tag !== expected.tag) return mismatch(path, actual, expected);

  const actualAttrs = Object.keys(actual.attrs).sort();
  const expectedAttrs = Object.keys(expected.attrs).sort();
  if (actualAttrs.length !== expectedAttrs.length || actualAttrs.some((name, index) => name !== expectedAttrs[index] || actual.attrs[name] !== expected.attrs[name])) {
    return mismatch(path, actual, expected);
  }
  if (actual.children.length !== expected.children.length) {
    const childIndex = Math.min(actual.children.length, expected.children.length);
    return mismatch(`${path}/children[${childIndex}]`, actual.children[childIndex], expected.children[childIndex]);
  }
  for (let index = 0; index < actual.children.length; index += 1) {
    const result = compareNodes(actual.children[index], expected.children[index], `${path}/children[${index}]`);
    if (!result.equal) return result;
  }
  return { equal: true };
}

export function domEquivalent(a: string, b: string): { equal: boolean; message?: string } {
  const actual = normalize(parseHtml(a));
  const expected = normalize(parseHtml(b));
  if (actual.length !== expected.length) {
    const index = Math.min(actual.length, expected.length);
    return mismatch(`root[${index}]`, actual[index], expected[index]);
  }
  for (let index = 0; index < actual.length; index += 1) {
    const result = compareNodes(actual[index], expected[index], `root[${index}]`);
    if (!result.equal) return result;
  }
  return { equal: true };
}

export function assertDomEquivalent(actualHtml: string, expectedHtml: string, message?: string): void {
  const result = domEquivalent(actualHtml, expectedHtml);
  if (!result.equal) throw new Error(`${message ? `${message}: ` : ""}${result.message ?? "DOM is not equivalent"}`);
}

function findElement(nodes: Node[], predicate: (node: ElementNode) => boolean): ElementNode | undefined {
  for (const node of nodes) {
    if (node.type !== "element") continue;
    if (predicate(node)) return node;
    const descendant = findElement(node.children, predicate);
    if (descendant) return descendant;
  }
  return undefined;
}

export function extractById(html: string, id: string): string {
  const node = findElement(normalize(parseHtml(html)), (candidate) => candidate.attrs.id === id);
  if (!node) throw new Error(`Element with id "${id}" was not found`);
  return serializeCanonical([node]);
}

export function extractFirstByClass(html: string, className: string): string {
  const node = findElement(normalize(parseHtml(html)), (candidate) => (candidate.attrs.class ?? "").split(/\s+/u).includes(className));
  if (!node) throw new Error(`Element with class "${className}" was not found`);
  return serializeCanonical([node]);
}
