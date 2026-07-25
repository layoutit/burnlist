import { scanXml } from "../ovens/dsl/xml-scan.mjs";

const definitions = Object.freeze({
  screen: {
    parents: [],
    attrs: ["id", "title", "version"],
    required: ["id", "title", "version"],
    children: ["brand-header", "section-heading", "burnlist-list", "oven-list", "detail-split", "oven-detail", "item-detail", "header", "columns", "stack", "panel", "resource-list", "burn-progress", "checklist", "glyph-scene", "footer"],
  },
  "brand-header": {
    attrs: ["title", "subtitle"],
    required: ["title"],
    children: [],
  },
  "section-heading": {
    attrs: ["id", "title", "source"],
    required: ["id", "title", "source"],
    children: [],
  },
  "burnlist-list": {
    attrs: ["id", "source", "empty", "flex"],
    required: ["id", "source"],
    children: [],
  },
  "oven-list": {
    attrs: ["id", "source", "empty", "flex"],
    required: ["id", "source"],
    children: [],
  },
  "detail-split": {
    attrs: ["collapse-at", "summary-width"],
    children: ["detail-summary", "oven-view"],
  },
  "detail-summary": {
    attrs: ["source", "fire-width", "fire-height", "fps"],
    required: ["source"],
    children: [],
  },
  "oven-view": {
    attrs: ["source"],
    required: ["source"],
    children: [],
  },
  "oven-detail": {
    attrs: ["source"],
    required: ["source"],
    children: [],
  },
  "item-detail": {
    attrs: ["source"],
    required: ["source"],
    children: [],
  },
  header: {
    attrs: ["title", "subtitle"],
    required: ["title"],
    children: [],
  },
  columns: {
    attrs: ["gap", "collapse-at"],
    children: ["panel", "resource-list", "burn-progress", "checklist", "glyph-scene", "stack"],
  },
  stack: {
    attrs: ["direction", "gap", "flex"],
    children: ["panel", "resource-list", "burn-progress", "checklist", "glyph-scene", "stack"],
  },
  panel: {
    attrs: ["id", "title", "source", "flex", "width"],
    required: ["title"],
    children: ["resource-list", "burn-progress", "checklist", "glyph-scene", "stack"],
  },
  "resource-list": {
    attrs: ["id", "title", "source", "empty"],
    required: ["id", "title", "source"],
    children: [],
  },
  "burn-progress": {
    attrs: ["source"],
    required: ["source"],
    children: [],
  },
  checklist: {
    attrs: ["source", "empty"],
    required: ["source"],
    children: [],
  },
  "glyph-scene": {
    attrs: ["id", "geometry", "effect", "preset", "width", "height", "fps"],
    required: ["id", "geometry", "effect"],
    children: [],
  },
  footer: {
    attrs: ["hints"],
    required: ["hints"],
    children: [],
  },
});

const sourceNames = new Set(["projects", "burnlists", "ovens", "selection", "oven", "progress", "item"]);
const numericAttrs = new Set(["gap", "collapse-at", "summary-width", "fire-width", "fire-height", "flex", "width", "height", "fps"]);
const token = /^[a-z][a-z0-9-]*$/u;

function diagnostic(code, message, file, node, attribute) {
  const span = attribute ? node.attrSpans[attribute] ?? node.span : node.span;
  return {
    code,
    message,
    file,
    line: span?.line ?? 1,
    column: span?.column ?? 1,
    path: node.path ?? "",
  };
}

function validateNode(node, parent, file, diagnostics, ids) {
  const definition = definitions[node.name];
  if (!definition) {
    diagnostics.push(diagnostic("GLYPH_ELEMENT", `Unknown .glyph element <${node.name}>.`, file, node));
    return;
  }
  if (parent && !definitions[parent.name]?.children.includes(node.name)) {
    diagnostics.push(diagnostic("GLYPH_PARENT", `<${node.name}> is not allowed inside <${parent.name}>.`, file, node));
  }
  for (const name of Object.keys(node.attrs)) {
    if (!definition.attrs.includes(name)) {
      diagnostics.push(diagnostic("GLYPH_ATTRIBUTE", `Attribute ${name} is not allowed on <${node.name}>.`, file, node, name));
    }
  }
  for (const name of definition.required ?? []) {
    if (!node.attrs[name]?.trim()) {
      diagnostics.push(diagnostic("GLYPH_REQUIRED", `<${node.name}> requires ${name}.`, file, node));
    }
  }
  if (node.attrs.id) {
    if (!token.test(node.attrs.id)) diagnostics.push(diagnostic("GLYPH_ID", `Invalid id ${node.attrs.id}.`, file, node, "id"));
    if (ids.has(node.attrs.id)) diagnostics.push(diagnostic("GLYPH_DUPLICATE_ID", `Duplicate id ${node.attrs.id}.`, file, node, "id"));
    ids.add(node.attrs.id);
  }
  if (node.attrs.source && !sourceNames.has(node.attrs.source)) {
    diagnostics.push(diagnostic("GLYPH_SOURCE", `Unknown data source ${node.attrs.source}.`, file, node, "source"));
  }
  for (const name of numericAttrs) {
    if (node.attrs[name] === undefined) continue;
    const value = Number(node.attrs[name]);
    if (!Number.isFinite(value) || value <= 0) {
      diagnostics.push(diagnostic("GLYPH_NUMBER", `${name} must be a positive number.`, file, node, name));
    }
  }
  if (node.name === "screen" && node.attrs.version !== "1") {
    diagnostics.push(diagnostic("GLYPH_VERSION", "Only .glyph screen version 1 is supported.", file, node, "version"));
  }
  if (node.name === "glyph-scene") {
    if (node.attrs.geometry !== "fire") diagnostics.push(diagnostic("GLYPH_GEOMETRY", "The first .glyph runtime supports geometry=fire.", file, node, "geometry"));
    if (node.attrs.effect !== "field-synth") diagnostics.push(diagnostic("GLYPH_EFFECT", "The first .glyph runtime supports effect=field-synth.", file, node, "effect"));
  }
  for (const child of node.children) validateNode(child, node, file, diagnostics, ids);
}

function typedAttributes(attrs) {
  return Object.fromEntries(Object.entries(attrs).map(([name, value]) => [
    name.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase()),
    numericAttrs.has(name) ? Number(value) : value,
  ]));
}

function toIR(node) {
  return {
    kind: node.name,
    attributes: typedAttributes(node.attrs),
    children: node.children.map(toIR),
    source: { offset: node.span.offset, line: node.span.line, column: node.span.column },
  };
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function compileGlyph(source, { file = "<screen.glyph>" } = {}) {
  const parsed = scanXml(source, { file });
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };
  const diagnostics = [];
  if (parsed.ast.name !== "screen") {
    diagnostics.push(diagnostic("GLYPH_ROOT", ".glyph documents require a <screen> root.", file, parsed.ast));
  }
  validateNode(parsed.ast, null, file, diagnostics, new Set());
  if (diagnostics.length) return { ok: false, diagnostics };
  return {
    ok: true,
    ir: deepFreeze({
      schema: "burnlist-glyph-screen@1",
      id: parsed.ast.attrs.id,
      title: parsed.ast.attrs.title,
      version: 1,
      root: toIR(parsed.ast),
    }),
  };
}
