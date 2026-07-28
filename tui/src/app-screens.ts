import { compileGlyph, type GlyphScreen } from "../../src/glyph/glyph-compile.mjs";
import { adaptChecklist } from "../../dashboard/src/lib/checklist-adapter";
import burnlistSource from "../screens/burnlist.glyph" with { type: "text" };
import homeSource from "../screens/home.glyph" with { type: "text" };
import itemSource from "../screens/item.glyph" with { type: "text" };
import ovenSource from "../screens/oven.glyph" with { type: "text" };
import ovensSource from "../screens/ovens.glyph" with { type: "text" };
import type { JsonValue } from "./oven-runtime/terminal-contract";
import type { BurnlistSummary, OvenSummary, ProgressSnapshot } from "./types";

function screen(source: string, file: string): GlyphScreen {
  const compiled = compileGlyph(source, { file });
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((entry) => `${entry.code}: ${entry.message}`).join("\n"));
  return compiled.ir;
}

export const screens = {
  home: screen(homeSource, "home.glyph"),
  ovens: screen(ovensSource, "ovens.glyph"),
  oven: screen(ovenSource, "oven.glyph"),
  burnlist: screen(burnlistSource, "burnlist.glyph"),
  item: screen(itemSource, "item.glyph"),
};

export type View = keyof typeof screens;

export function terminalChecklistPayload(progress: ProgressSnapshot, selectedItemId?: string | null, loopRun?: ProgressSnapshot["loopRun"]): JsonValue {
  const payload = adaptChecklist({
    ...progress,
    selectedItemId: selectedItemId ?? progress.selectedItemId,
    loopRun: loopRun === undefined ? progress.loopRun : loopRun,
    history: progress.history ?? [],
    active: progress.active.map((item) => ({ ...item, fields: item.fields ?? {} })),
    completed: progress.completed.map((item) => ({ ...item, detail: item.detail ?? "" })),
  });
  return JSON.parse(JSON.stringify(payload)) as JsonValue;
}

export const isManagedChecklist = (oven: OvenSummary | null | undefined, burnlist: BurnlistSummary | null | undefined) =>
  oven?.contract === "checklist-progress@1"
  && oven.dataInput === "json-payload"
  && typeof burnlist?.planPath === "string"
  && burnlist.planPath.length > 0;
