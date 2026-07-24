import { createHash } from "node:crypto";

const encoder = new TextEncoder();
const MAX_U32 = 0xffffffff;
const MAX_U64 = (1n << 64n) - 1n;

export function utf8(value) { return encoder.encode(String(value)); }

function length32(length) {
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_U32) throw new RangeError("u32 length overflow");
  const out = Buffer.allocUnsafe(4); out.writeUInt32BE(length); return out;
}
function length64(length) {
  if (!Number.isSafeInteger(length) || length < 0 || BigInt(length) > MAX_U64) throw new RangeError("u64 length overflow");
  const out = Buffer.allocUnsafe(8); out.writeBigUInt64BE(BigInt(length)); return out;
}
function bytes(value) { return Buffer.isBuffer(value) ? value : Buffer.from(value); }

/** Stage 1's domain-separated digest framing. */
export function hashFields(domain, fields) {
  const digest = createHash("sha256");
  const domainBytes = Buffer.from(utf8(domain));
  digest.update("burnlist-hash-v1\0", "utf8");
  digest.update(length32(domainBytes.length));
  digest.update(domainBytes);
  digest.update(length32(fields.length));
  for (const field of fields) {
    const value = bytes(field);
    digest.update(length64(value.length));
    digest.update(value);
  }
  return digest.digest("hex");
}

export function prefixed(prefix, domain, fields) {
  return `${prefix}${hashFields(domain, fields)}`;
}

export function rawSha256(value) { return `sha256:${createHash("sha256").update(bytes(value)).digest("hex")}`; }
