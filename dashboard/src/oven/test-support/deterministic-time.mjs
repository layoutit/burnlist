const FIXED_NOW = Date.parse("2026-01-01T12:30:00.000Z");

export function withDeterministicTime(fn) {
  const previousTz = process.env.TZ;
  const previousDateNow = Date.now;
  const OriginalDTF = globalThis.Intl.DateTimeFormat;
  const originalToLocaleString = Date.prototype.toLocaleString;
  const originalToLocaleTimeString = Date.prototype.toLocaleTimeString;
  const originalToLocaleDateString = Date.prototype.toLocaleDateString;
  const Shim = function DateTimeFormat(locales, options) {
    return new OriginalDTF(locales == null ? "en-US" : locales, { timeZone: "UTC", ...(options || {}) });
  };
  const withUtc = (original) => function toLocaleDate(locales, options) {
    return original.call(this, locales == null ? "en-US" : locales, { timeZone: "UTC", ...(options || {}) });
  };

  Shim.prototype = OriginalDTF.prototype;
  Object.setPrototypeOf(Shim, OriginalDTF);
  process.env.TZ = "UTC";
  Date.now = () => FIXED_NOW;
  globalThis.Intl.DateTimeFormat = Shim;
  Date.prototype.toLocaleString = withUtc(originalToLocaleString);
  Date.prototype.toLocaleTimeString = withUtc(originalToLocaleTimeString);
  Date.prototype.toLocaleDateString = withUtc(originalToLocaleDateString);
  try {
    return fn();
  } finally {
    globalThis.Intl.DateTimeFormat = OriginalDTF;
    Date.prototype.toLocaleString = originalToLocaleString;
    Date.prototype.toLocaleTimeString = originalToLocaleTimeString;
    Date.prototype.toLocaleDateString = originalToLocaleDateString;
    Date.now = previousDateNow;
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
}
