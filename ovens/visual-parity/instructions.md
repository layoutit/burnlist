# Visual Parity

Visual Parity compares trusted reference and candidate frames as isolated render passes. Each domain declares whether it qualifies the current scenario (`target`) or remains visible diagnostic context (`context`), so unrelated render domains never contaminate one another.

The project adapter publishes `burnlist-visual-parity-data@1`. A passing domain must satisfy its explicit calibrated channel, mean-delta, and changed-pixel bounds. Context domains remain visible and retain their own pass/fail state, but do not decide the target scenario verdict.

Do not widen a tolerance to make a regression green. Calibrate only a deterministic renderer-boundary residual with a written rationale, preserve the zero-tolerance default, and keep gameplay/state authority in the linked Differential Testing payload.
