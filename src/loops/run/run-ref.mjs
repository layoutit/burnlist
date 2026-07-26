/** Canonical 128-bit RunRef encoded as 26 lowercase Crockford digits. */
export const RUN_REF = /^run:[0-7][0-9a-hjkmnp-tv-z]{25}$/u;

export function isRunRef(value) {
  return typeof value === "string" && RUN_REF.test(value);
}
