export const PAIR_GAP_PX = 16;
export const PAIR_ROOT_FONT_PX = 16;

export function pairMinimumPaneRem(component) {
  return component === "field-list-cards" ? 48 : 34;
}

/** Mirrors the CSS auto-fit decision for deterministic overlap/bounds tests. */
export function pairedPreviewRects(width, component) {
  const safeWidth = Math.max(0, Number(width) || 0);
  const minimum = pairMinimumPaneRem(component) * PAIR_ROOT_FONT_PX;
  const columns = safeWidth >= minimum * 2 + PAIR_GAP_PX ? 2 : 1;
  const paneWidth = columns === 2 ? (safeWidth - PAIR_GAP_PX) / 2 : safeWidth;
  return Array.from({ length: 2 }, (_, index) => ({
    x: columns === 2 ? index * (paneWidth + PAIR_GAP_PX) : 0,
    y: columns === 2 ? 0 : index,
    width: paneWidth,
  }));
}
