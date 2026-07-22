export const OVEN_RESPONSE_CHUNK_BYTES = 64 * 1024;
export const OVEN_RESPONSE_TIMEOUT_MS = 30_000;

export function streamOvenResponse(req, res, segments, {
  chunkBytes = OVEN_RESPONSE_CHUNK_BYTES,
  timeoutMs = OVEN_RESPONSE_TIMEOUT_MS,
  timers = globalThis,
  onCleanup = () => {},
} = {}) {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new Error("Oven response chunkBytes must be positive.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("Oven response timeoutMs must be positive.");
  if (!Array.isArray(segments) || segments.some((segment) => !Buffer.isBuffer(segment))) {
    throw new Error("Oven response segments must be Buffers.");
  }
  let segmentIndex = 0;
  let segmentOffset = 0;
  let closed = false;
  let waitingDrain = false;
  let stallTimeout = null;

  const clearStallTimeout = () => {
    if (stallTimeout === null) return;
    timers.clearTimeout(stallTimeout);
    stallTimeout = null;
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearStallTimeout();
    res.off?.("drain", onDrain);
    res.off?.("close", cleanup);
    res.off?.("error", cleanup);
    res.off?.("finish", cleanup);
    req.off?.("aborted", abort);
    onCleanup();
  };
  const abort = () => {
    cleanup();
    if (!res.destroyed) res.destroy?.();
  };
  const armStallTimeout = () => {
    clearStallTimeout();
    stallTimeout = timers.setTimeout(abort, timeoutMs);
  };
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
          const end = Math.min(segmentOffset + chunkBytes, segment.length);
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
