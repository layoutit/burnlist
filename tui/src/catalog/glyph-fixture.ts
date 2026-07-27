export const glyphFixture = Object.freeze({
  id: "glyphcss-interactive-flame",
  title: "Glyph fixture: é 界",
  hint: "right: select ember",
  states: Object.freeze([
    { checkpoint: "t0", interaction: "initial", animation: "t0", motion: "full", selected: "flame", reducedMotion: false, advanceMs: 0, key: null, viewports: [42, 64] },
    { checkpoint: "t240", interaction: "initial", animation: "t240", motion: "full", selected: "flame", reducedMotion: false, advanceMs: 240, key: null, viewports: [42] },
    { checkpoint: "keyboard-right", interaction: "right", animation: "t240", motion: "full", selected: "ember", reducedMotion: false, advanceMs: 240, key: "right", viewports: [42] },
    { checkpoint: "reduced-t0", interaction: "initial", animation: "t0", motion: "reduced", selected: "flame", reducedMotion: true, advanceMs: 0, key: null, viewports: [42] },
    { checkpoint: "reduced-t240", interaction: "initial", animation: "t240", motion: "reduced", selected: "flame", reducedMotion: true, advanceMs: 240, key: null, viewports: [42] },
  ]),
});

export type GlyphFixtureState = (typeof glyphFixture.states)[number];
