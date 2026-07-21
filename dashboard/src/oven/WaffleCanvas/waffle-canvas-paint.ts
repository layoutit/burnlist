export const WAFFLE_PASS_COLOR = "#61d394";
export const WAFFLE_FAIL_COLOR = "#ef4444";
export const WAFFLE_EMPTY_COLOR = "rgb(168,168,168)";
export const WAFFLE_COLUMNS = 10;
export const WAFFLE_ROWS = 8;
export const WAFFLE_CELLS = WAFFLE_COLUMNS * WAFFLE_ROWS;

export type WaffleCanvasBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WaffleCanvasCell = {
  x: number;
  y: number;
  width: 3;
  height: 3;
  fillStyle: string;
  globalAlpha: number;
};

export type WaffleCanvasLike = {
  dataset: { failedCells?: string; empty?: string };
  style: { transform: string };
  width: number;
  height: number;
  getContext: (contextId: "2d") => WaffleCanvasContext | null;
};

export type WaffleCanvasContext = {
  globalAlpha: number;
  fillStyle: string;
  setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  clearRect: (x: number, y: number, width: number, height: number) => void;
  fillRect: (x: number, y: number, width: number, height: number) => void;
};

export function waffleCanvasSizing(box: WaffleCanvasBox, scale: number) {
  const dx = Math.round(box.x * scale) / scale - box.x;
  const dy = Math.round(box.y * scale) / scale - box.y;
  const cssWidth = Math.max(1, Math.round(box.width));
  const cssHeight = Math.max(1, Math.round(box.height));
  const bitmapWidth = Math.max(1, Math.round(cssWidth * scale));
  const bitmapHeight = Math.max(1, Math.round(cssHeight * scale));
  const transform = Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001
    ? `translate(${dx.toFixed(3)}px, ${dy.toFixed(3)}px)`
    : "";
  return { cssWidth, cssHeight, bitmapWidth, bitmapHeight, dx, dy, transform };
}

export function waffleCellPlan(
  failedCells: number,
  empty: boolean,
  cssWidth: number,
  cssHeight: number,
  passColor: string,
  failColor: string,
): WaffleCanvasCell[] {
  const cells: WaffleCanvasCell[] = [];
  for (let index = 0; index < WAFFLE_CELLS; index += 1) {
    const row = Math.floor(index / WAFFLE_COLUMNS);
    const column = index % WAFFLE_COLUMNS;
    const rightColumnRank = (WAFFLE_COLUMNS - 1 - column) * WAFFLE_ROWS + (WAFFLE_ROWS - 1 - row);
    const failed = rightColumnRank < failedCells;
    cells.push({
      x: Math.max(0, cssWidth - 39) + column * 4,
      y: Math.max(0, Math.floor((cssHeight - 31) / 2)) + row * 4,
      width: 3,
      height: 3,
      globalAlpha: empty ? 0.2 : failed ? 1 : 0.34,
      fillStyle: empty ? WAFFLE_EMPTY_COLOR : failed ? failColor : passColor,
    });
  }
  return cells;
}

export function paintWaffleCanvas(
  canvas: WaffleCanvasLike,
  { scale, box, passColor = WAFFLE_PASS_COLOR, failColor = WAFFLE_FAIL_COLOR }: {
    scale: number;
    box: WaffleCanvasBox;
    passColor?: string;
    failColor?: string;
  },
) {
  const sizing = waffleCanvasSizing(box, scale);
  canvas.style.transform = sizing.transform;
  if (canvas.width !== sizing.bitmapWidth) canvas.width = sizing.bitmapWidth;
  if (canvas.height !== sizing.bitmapHeight) canvas.height = sizing.bitmapHeight;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, sizing.cssWidth, sizing.cssHeight);
  const failedCells = Math.max(0, Math.min(WAFFLE_CELLS, Number(canvas.dataset.failedCells) || 0));
  const empty = canvas.dataset.empty === "true";
  for (const cell of waffleCellPlan(failedCells, empty, sizing.cssWidth, sizing.cssHeight, passColor, failColor)) {
    context.globalAlpha = cell.globalAlpha;
    context.fillStyle = cell.fillStyle;
    context.fillRect(cell.x, cell.y, cell.width, cell.height);
  }
  context.globalAlpha = 1;
  context.setTransform(1, 0, 0, 1, 0, 0);
}
