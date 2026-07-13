import { createHash } from "node:crypto";

const ovenWidgets = new Set([
  "metric",
  "progress",
  "line-chart",
  "bar-chart",
  "pie-chart",
  "table",
  "comparison",
  "status",
  "chart",
  "list",
  "timeline",
  "log",
  "markdown",
  "timestamp",
]);

const ovenFormats = new Set(["plain", "number", "percent", "duration", "timestamp"]);

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function assertKnownKeys(value, allowed, label) {
  if (!plainObject(value)) throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported field "${key}".`);
  }
}

export function boundedText(value, label, maxLength, required = true) {
  const text = String(value ?? "").trim();
  if (required && !text) throw new Error(`${label} is required.`);
  if (text.length > maxLength) throw new Error(`${label} is longer than ${maxLength} characters.`);
  return text;
}

export function ovenId(value) {
  const id = boundedText(value, "Oven id", 48);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) throw new Error("Oven id must be a lowercase slug.");
  return id;
}

function boundedInteger(value, label, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return number;
}

export function normalizeOvenDetail(value) {
  assertKnownKeys(value, new Set(["version", "columns", "rows", "rowHeight", "cells"]), "Detail template");
  const version = boundedInteger(value.version, "Detail template version", 1, 1);
  const columns = boundedInteger(value.columns, "Detail template columns", 2, 24);
  const rows = boundedInteger(value.rows, "Detail template rows", 2, 32);
  const rowHeight = boundedInteger(value.rowHeight, "Detail template row height", 32, 120);
  if (!Array.isArray(value.cells) || value.cells.length < 1 || value.cells.length > 32) {
    throw new Error("Detail template sections must contain between 1 and 32 entries.");
  }
  const occupied = new Set();
  const ids = new Set();
  const cells = value.cells.map((cell, index) => {
    const label = `Detail section ${index + 1}`;
    assertKnownKeys(cell, new Set([
      "id",
      "title",
      "description",
      "widget",
      "source",
      "format",
      "column",
      "row",
      "columnSpan",
      "rowSpan",
    ]), label);
    const id = ovenId(cell.id);
    if (ids.has(id)) throw new Error(`Detail section id "${id}" is duplicated.`);
    ids.add(id);
    const title = boundedText(cell.title, `${label} title`, 80);
    const description = boundedText(cell.description ?? cell.title, `${label} metric description`, 2000);
    const widget = boundedText(cell.widget, `${label} widget`, 24);
    if (!ovenWidgets.has(widget)) throw new Error(`${label} uses unsupported widget "${widget}".`);
    const source = boundedText(cell.source, `${label} source`, 160, false);
    if (source && !source.startsWith("/")) throw new Error(`${label} source must start with "/".`);
    const format = boundedText(cell.format || "plain", `${label} format`, 24);
    if (!ovenFormats.has(format)) throw new Error(`${label} uses unsupported format "${format}".`);
    const column = boundedInteger(cell.column, `${label} column`, 1, columns);
    const row = boundedInteger(cell.row, `${label} row`, 1, rows);
    const columnSpan = boundedInteger(cell.columnSpan, `${label} column span`, 1, columns);
    const rowSpan = boundedInteger(cell.rowSpan, `${label} row span`, 1, rows);
    if (column + columnSpan - 1 > columns || row + rowSpan - 1 > rows) {
      throw new Error(`${label} extends outside the detail skeleton.`);
    }
    for (let gridRow = row; gridRow < row + rowSpan; gridRow += 1) {
      for (let gridColumn = column; gridColumn < column + columnSpan; gridColumn += 1) {
        const key = `${gridRow}:${gridColumn}`;
        if (occupied.has(key)) throw new Error(`${label} overlaps another detail section.`);
        occupied.add(key);
      }
    }
    return { id, title, description, widget, source, format, column, row, columnSpan, rowSpan };
  });
  return { version, columns, rows, rowHeight, cells };
}

export function normalizeOvenPackage(value) {
  assertKnownKeys(value, new Set(["id", "instructions", "detail"]), "Oven package");
  const id = ovenId(value.id);
  const instructions = boundedText(value.instructions, `Oven ${id} instructions`, 65536);
  if (!/^#\s+\S/mu.test(instructions)) {
    throw new Error(`Oven ${id} instructions must contain a level-one heading.`);
  }
  return {
    id,
    instructions,
    detail: normalizeOvenDetail(value.detail),
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// Callers pass an Oven package whose instructions and detail have already been
// normalized by normalizeOvenPackage. Only its portable content defines this id.
export function ovenRevision(pkg) {
  const instructions = String(pkg.instructions ?? "").replace(/\r\n?/gu, "\n");
  const contents = canonicalJson({
    format: "burnlist-oven-content@1",
    instructions,
    detail: pkg.detail,
  });
  return `o1-sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

export function normalizeOvenForkedFrom(value) {
  assertKnownKeys(value, new Set(["forkedFrom"]), "Oven lineage");
  if (!plainObject(value.forkedFrom)) throw new Error("Oven lineage forkedFrom must be an object.");
  assertKnownKeys(value.forkedFrom, new Set(["ovenId", "revision"]), "Oven lineage forkedFrom");
  const revision = boundedText(value.forkedFrom.revision, "Oven lineage revision", 74);
  if (!/^o1-sha256:[a-f0-9]{64}$/u.test(revision)) {
    throw new Error("Oven lineage revision must be an o1-sha256 digest.");
  }
  return { forkedFrom: { ovenId: ovenId(value.forkedFrom.ovenId), revision } };
}
