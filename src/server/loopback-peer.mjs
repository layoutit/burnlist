const LOOPBACK_ADDRESSES = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

export function isLoopbackPeerAddress(value) {
  return typeof value === "string" && LOOPBACK_ADDRESSES.has(value);
}

export function withoutWriteToken(value, remoteAddress) {
  if (isLoopbackPeerAddress(remoteAddress) || !value || typeof value !== "object") return value;
  const { writeToken: _writeToken, ...publicValue } = value;
  return publicValue;
}
