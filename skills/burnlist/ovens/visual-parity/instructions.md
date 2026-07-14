# Visual Parity

Visual Parity compares trusted reference frames with candidate frames while preserving the Differential Testing dashboard structure. The final row presents shared field-list cards sampled every 100 frames, each with reference, candidate, and magnitude-heatmap screenshots. The summary, progress, and log rows remain evidence summaries rather than visual approval signals.

## State Contract

The project adapter publishes `burnlist-visual-parity-data@1` through `--oven-data visual-parity=<path>`. The document contains:

- one valid `burnlist-differential-testing-data@1` document for the shared summary, progress, and log rows
- one ordered comparison record for every captured frame, with stable identity, frame number, labels, dimensions, and status
- exact changed-pixel totals, ratio, mean absolute delta, and maximum absolute delta for every frame
- complete reference, candidate, and diff image triplets for frames 0, 100, 200, through 900 in a 1,000-frame scenario

The adapter owns screenshot capture, alignment, normalization, pixel comparison, freshness, and atomic publication. The Oven only validates and renders the normalized document.

## Evidence Rules

Reference and candidate frames must come from the same scenario, viewport, camera, frame, resolution, color pipeline, and capture boundary. Comparable frames must have identical dimensions. A missing, stale, misaligned, partially written, or differently configured frame blocks publication.

Do not resize, crop, stretch, recolor, blur, or otherwise normalize one side differently to improve the result. The diff may visualize exact channel-delta magnitude over dim grayscale reference context, but it must not change the recorded comparison. Do not infer a pass from visual inspection when the pixel comparison reports a failure.

The frame comparison status is independent of the retained Differential Testing state summary. Both views share scenario identity and capture inputs, but either one may pass while the other fails.

## Result Semantics

- `pass`: both frames are comparable and no pixels differ
- `fail`: both frames are comparable and at least one pixel differs

Keep screenshot files, captures, and project-specific evidence outside the Oven package. Publish only local adapter data and image references through ignored project state.
