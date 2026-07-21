import type { WaffleCanvasBox, WaffleCanvasContext, WaffleCanvasLike } from "../WaffleCanvas/waffle-canvas-paint";

export type CanvasOperation =
  | ["setTransform", number, number, number, number, number, number]
  | ["clearRect", number, number, number, number]
  | ["globalAlpha", number]
  | ["fillStyle", string]
  | ["fillRect", number, number, number, number];

export function createRecordingCanvas(
  box: WaffleCanvasBox,
  dataset: { failedCells?: string; empty?: string },
) {
  const operations: CanvasOperation[] = [];
  let globalAlpha = 1;
  let fillStyle = "";
  const context: WaffleCanvasContext = {
    get globalAlpha() { return globalAlpha; },
    set globalAlpha(value) { globalAlpha = value; operations.push(["globalAlpha", value]); },
    get fillStyle() { return fillStyle; },
    set fillStyle(value) { fillStyle = value; operations.push(["fillStyle", value]); },
    setTransform(a, b, c, d, e, f) { operations.push(["setTransform", a, b, c, d, e, f]); },
    clearRect(x, y, width, height) { operations.push(["clearRect", x, y, width, height]); },
    fillRect(x, y, width, height) { operations.push(["fillRect", x, y, width, height]); },
  };
  const canvas: WaffleCanvasLike = {
    dataset,
    style: { transform: "" },
    width: 0,
    height: 0,
    getContext: () => context,
  };
  return { box, canvas, context, operations };
}
