export function processStartWall({ nowMilliseconds, uptimeSeconds }) {
  if (!Number.isFinite(nowMilliseconds) || nowMilliseconds < 0
    || !Number.isFinite(uptimeSeconds) || uptimeSeconds < 0) {
    throw Object.assign(new Error("Loop clock: invalid process-start inputs"), { code: "ELOOP_BUDGET" });
  }
  return Math.max(0, Math.round(nowMilliseconds - (uptimeSeconds * 1_000)));
}
