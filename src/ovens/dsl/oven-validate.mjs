import { diagnostics } from "./oven-diagnostics.mjs";
import { ELEMENTS, REGISTRY, REQUIRED_PROPS } from "./oven-grammar.mjs";

const idRE = /^[a-z][a-z0-9-]{0,63}$/;
const pointer = (value, itemOk) => value === "" || value === "/" || /^\/(?:[^~/]|~[01])*(?:\/(?:[^~/]|~[01])*)*$/.test(value) || (itemOk && /^@item(?:\/(?:[^~/]|~[01])*(?:\/(?:[^~/]|~[01])*)*)?$/.test(value));
const controls = new Set(["mode-toggle", "search", "sort-toggle", "filter-toggle", "domain-tabs"]);
const ints = new Set(["version", "refresh-seconds", "columns", "rows", "row-height", "column", "row", "column-span", "row-span", "page-size", "debounce-ms"]);

function walk(node, fn, parent = null, itemScope = false, ancestors = []) { fn(node, parent, itemScope, ancestors); for (const child of node.children) walk(child, fn, node, itemScope || node.name === "each" || node.name === "column", [...ancestors, node]); }
function add(d, code, msg, node, attr) { d.add(code, msg, { ...(attr ? node.attrSpans[attr] : node.span), path: node.path }); }

export function validateOven(ast, { file = "<oven>" } = {}) {
  const d = diagnostics(file), ids = new Map(), refs = [], collections = new Map();
  if (!ast || ast.name !== "oven") add(d, "GRAMMAR_ROOT", "Root element must be <oven>", ast ?? {});
  walk(ast, (node, parent, itemScope, ancestors) => {
    const rule = ELEMENTS[node.name];
    if (!rule) { add(d, "GRAMMAR_ELEMENT", `Unknown element <${node.name}>`, node); return; }
    if (parent && !(ELEMENTS[parent.name]?.children ?? []).includes(node.name)) add(d, "GRAMMAR_CHILD", `<${node.name}> is not allowed inside <${parent.name}>`, node);
    for (const key of Object.keys(node.attrs)) if (!rule.attrs.includes(key)) add(d, "GRAMMAR_ATTRIBUTE", `Attribute ${key} is not allowed on <${node.name}>`, node, key);
    for (const required of requiredAttrs(node.name)) if (!(required in node.attrs)) add(d, "GRAMMAR_REQUIRED", `<${node.name}> requires ${required}`, node);
    const a = node.attrs;
    if (a.id !== undefined) { if (!idRE.test(a.id)) add(d, "SCALAR_ID", `Invalid id ${a.id}`, node, "id"); else if (ids.has(a.id)) add(d, "REFERENCE_ID", `Duplicate id ${a.id}`, node, "id"); else ids.set(a.id, node); }
    for (const [key, value] of Object.entries(a)) {
      if (ints.has(key) && (!/^\d+$/.test(value) || Number(value) < 1 || (key === "refresh-seconds" && Number(value) > 3600) || (key === "columns" && Number(value) > 24))) add(d, "SCALAR_INTEGER", `${key} must be a valid positive integer`, node, key);
      if (["optional", "default"].includes(key) && !["true", "false"].includes(value)) add(d, "SCALAR_BOOLEAN", `${key} must be true or false`, node, key);
      if (["source", "item-key", "requires-source", "initial-source"].includes(key) && !pointer(value, itemScope || node.name === "column")) add(d, "SCALAR_POINTER", `${key} must be an RFC 6901 pointer${itemScope || node.name === "column" ? " or @item pointer" : ""}`, node, key);
      if (["title", "value", "done", "total", "percent"].includes(key) && value.startsWith("/") && !pointer(value, false)) add(d, "SCALAR_POINTER", `${key} must be an RFC 6901 pointer when it starts with /`, node, key);
    }
    if (a.source?.startsWith("@item") && !itemScope && node.name !== "column") add(d, "SCALAR_ITEM_SCOPE", "@item may only be used in an item scope", node, "source");
    if (a.format && !REGISTRY.formats.has(a.format)) add(d, "REGISTRY_FORMAT", `Unknown format ${a.format}`, node, "format");
    if (node.name === "icon" && !REGISTRY.icons.has(a.name)) add(d, "REGISTRY_ICON", `Unknown icon ${a.name}`, node, "name");
    if (node.name === "kpi-item" && a.icon && !REGISTRY.icons.has(a.icon)) add(d, "REGISTRY_ICON", `Unknown icon ${a.icon}`, node, "icon");
    if (node.name === "kpi-item" && a.variant && !["current", "scenario", "burns", "fields", "frames"].includes(a.variant)) add(d, "SCALAR_VARIANT", "kpi-item variant is not registered", node, "variant");
    if (node.name === "oven") { if (!REGISTRY.themes.has(a.theme)) add(d, "REGISTRY_THEME", `Unknown theme ${a.theme}`, node, "theme"); if (!REGISTRY.contracts.has(a.contract)) add(d, "REGISTRY_CONTRACT", `Unknown contract ${a.contract}`, node, "contract"); if (a.version !== "1") add(d, "SCALAR_VERSION", "Only oven version 1 is supported", node, "version"); }
    if (node.name === "box" && !["div", "section", "main", "span"].includes(a.element)) add(d, "SCALAR_ELEMENT", "box element must be div, section, main, or span", node, "element");
    if (node.name === "sort-toggle" && !REGISTRY.sorts.has(a.key)) add(d, "REGISTRY_SORT", `Unknown sort ${a.key}`, node, "key");
    if (node.name === "filter-toggle" && !REGISTRY.filters.has(a.key)) add(d, "REGISTRY_FILTER", `Unknown filter ${a.key}`, node, "key");
    if (node.name === "collection") collections.set(a.id, node);
    for (const key of ["mode-from", "search-from", "filter-from", "sort-from", "collection-from", "selection-from"]) if (a[key]) refs.push([node, key, a[key]]);
    if (node.name === "text" && ((a.text === undefined) === (a.source === undefined))) add(d, "GRAMMAR_TEXT", "<text> requires exactly one of text or source", node);
    if (node.name === "case" && ((a.value !== undefined) === (a.default === "true"))) add(d, "GRAMMAR_CASE", "<case> requires value or default=true", node);
    if (node.name === "switch" && ((a.source !== undefined) === (a["mode-from"] !== undefined))) add(d, "GRAMMAR_SWITCH_SOURCE", "<switch> requires exactly one of source or mode-from", node);
    if (node.name === "mode-toggle" && node.children.filter((x) => x.name === "option").length < 2) add(d, "STRUCTURE_OPTIONS", "<mode-toggle> requires at least two options", node);
    if (controls.has(node.name) && ancestors.some((x) => x.name === "each")) add(d, "INTERACTION_EACH", "Controls are not allowed inside <each>", node);
    if (node.name === "pagination" && !ancestors.some((x) => x.name === "collection")) add(d, "INTERACTION_PAGINATION", "<pagination> must be inside a collection", node);
  });
  for (const [node, key, value] of refs) {
    const target = ids.get(value);
    const kinds = { "mode-from": ["mode-toggle"], "search-from": ["search"], "filter-from": ["filter-toggle"], "sort-from": ["sort-toggle"], "collection-from": ["collection"], "selection-from": ["domain-tabs"] }[key];
    if (!target || !kinds.includes(target.name)) add(d, "REFERENCE_TARGET", `${key} must name a ${kinds.join(" or ")}`, node, key);
  }
  gridChecks(ast, d); switchChecks(ast, d); propChecks(ast, d); interactionChecks(ast, d);
  return { ok: d.list.length === 0, diagnostics: d.list, ids, collections };
}
function requiredAttrs(name) { return ({ oven: ["id", "version", "contract", "theme"], box: ["element"], grid: ["columns"], panel: ["id"], collection: ["id", "source", "item-key", "paging", "page-size"], bind: ["prop", "source"], icon: ["slot", "name"], column: ["label", "source"], "log-table": ["source"], "mode-toggle": ["id", "initial", "aria-label"], option: ["value", "label"], search: ["id", "placeholder", "aria-label", "match-fields"], "sort-toggle": ["id", "key", "label", "initial"], "filter-toggle": ["id", "key", "label", "initial"], pagination: ["collection-from", "page-sizes"], "field-toolbar": ["id"] })[name] ?? []; }
function gridChecks(ast, d) { walk(ast, (grid) => { if (grid.name !== "grid") return; const cols = +grid.attrs.columns, rows = +(grid.attrs.rows ?? 0), boxes = []; for (const panel of grid.children.filter((x) => x.name === "panel" && x.attrs.column)) { const x = +panel.attrs.column, y = +panel.attrs.row, w = +(panel.attrs["column-span"] ?? 1), h = +(panel.attrs["row-span"] ?? 1); if (x + w - 1 > cols || (rows && y + h - 1 > rows)) add(d, "STRUCTURE_GRID_BOUNDS", "Panel is outside grid bounds", panel); for (const b of boxes) if (x <= b.x + b.w - 1 && b.x <= x + w - 1 && y <= b.y + b.h - 1 && b.y <= y + h - 1) add(d, "STRUCTURE_GRID_OVERLAP", "Panels overlap", panel); boxes.push({ x, y, w, h }); } }); }
function switchChecks(ast, d) { walk(ast, (node) => { if (node.name !== "switch") return; const cases = node.children.filter((x) => x.name === "case"), values = new Set(), defaults = cases.filter((x) => x.attrs.default === "true"); if (!cases.length) add(d, "STRUCTURE_SWITCH", "Switch requires a case", node); if (defaults.length > 1) add(d, "STRUCTURE_SWITCH", "Switch may have only one default", node); for (const c of cases) { if (c.attrs.value && values.has(c.attrs.value)) add(d, "STRUCTURE_SWITCH", "Switch case values must be unique", c); values.add(c.attrs.value); } }); }
function propChecks(ast, d) { walk(ast, (node) => { const required = REQUIRED_PROPS[node.name]; if (!required) return; const bound = node.children.filter((x) => x.name === "bind").map((x) => x.attrs.prop); for (const prop of required) if (bound.filter((x) => x === prop).length !== 1) add(d, "PROPS_REQUIRED", `<${node.name}> requires exactly one bind for ${prop}`, node); }); }
function interactionChecks(ast, d) { walk(ast, (node) => { if (node.name === "collection" && !["client", "server", "auto"].includes(node.attrs.paging)) add(d, "INTERACTION_PAGING", "paging must be client, server, or auto", node, "paging"); if (node.name === "pagination" && !node.attrs["page-sizes"].split(" ").every((x) => /^\d+$/.test(x) && +x > 0)) add(d, "INTERACTION_PAGE_SIZES", "page-sizes must be positive integers", node, "page-sizes"); }); }
