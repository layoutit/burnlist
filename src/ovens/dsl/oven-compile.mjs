import { readFile } from "node:fs/promises";
import { scanXml } from "./xml-scan.mjs";
import { validateOven } from "./oven-validate.mjs";
import { buildIR } from "./oven-ir.mjs";

export function compileOven(source, { file = "<oven>" } = {}) {
  const parsed = scanXml(source, { file });
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics };
  const checked = validateOven(parsed.ast, { file });
  if (!checked.ok) return { ok: false, diagnostics: checked.diagnostics };
  return { ok: true, ir: buildIR(parsed.ast) };
}

export async function compileOvenFile(path) {
  try { return compileOven(await readFile(path), { file: path }); }
  catch (error) { return { ok: false, diagnostics: [{ code: "FILE_READ", message: error.message, file: path, line: 1, column: 1, path: "" }] }; }
}
