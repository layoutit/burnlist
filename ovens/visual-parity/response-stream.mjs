export const VISUAL_PARITY_RESPONSE_CHUNK_BYTES = 64 * 1024;
export const VISUAL_PARITY_RESPONSE_TIMEOUT_MS = 30_000;

export function streamVisualParityResponse(req, res, segments, {
  onCleanup = () => {},
  timeoutMs = VISUAL_PARITY_RESPONSE_TIMEOUT_MS,
  timers = globalThis,
} = {}) {
  let segmentIndex = 0;
  let segmentOffset = 0;
  let closed = false;
  let waitingDrain = false;
  let stallTimeout = null;

  function clearStallTimeout() {
    if (stallTimeout === null) return;
    timers.clearTimeout(stallTimeout);
    stallTimeout = null;
  }
  function armStallTimeout() {
    clearStallTimeout();
    stallTimeout = timers.setTimeout(abort, timeoutMs);
  }

  function cleanup() {
    if (closed) return;
    closed = true;
    clearStallTimeout();
    res.off?.("drain", onDrain);
    res.off?.("close", cleanup);
    res.off?.("error", cleanup);
    res.off?.("finish", cleanup);
    req.off?.("aborted", abort);
    onCleanup();
  }
  function abort() {
    cleanup();
    if (!res.destroyed) res.destroy?.();
  }
  function onDrain() {
    waitingDrain = false;
    clearStallTimeout();
    pump();
  }
  function pump() {
    if (closed || waitingDrain) return;
    try {
      while (segmentIndex < segments.length) {
        const segment = segments[segmentIndex];
        while (segmentOffset < segment.length) {
          const end = Math.min(segmentOffset + VISUAL_PARITY_RESPONSE_CHUNK_BYTES, segment.length);
          const chunk = segment.subarray(segmentOffset, end);
          segmentOffset = end;
          if (!res.write(chunk)) {
            waitingDrain = true;
            res.once("drain", onDrain);
            armStallTimeout();
            return;
          }
        }
        segmentIndex += 1;
        segmentOffset = 0;
      }
      res.end();
      cleanup();
    } catch {
      abort();
    }
  }

  res.once("close", cleanup);
  res.once("error", cleanup);
  res.once("finish", cleanup);
  req.once?.("aborted", abort);
  pump();
}
