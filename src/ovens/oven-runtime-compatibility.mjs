// Five-key pins predate runtimeCompatibility and always represent the v1 runtime.
export const LEGACY_OVEN_RUNTIME_COMPATIBILITY = "burnlist-oven-runtime@1";
export const OVEN_RUNTIME_COMPATIBILITY = "burnlist-oven-runtime@1";

const compatibilityPattern = /^burnlist-oven-runtime@[1-9][0-9]*$/u;

export function ovenRuntimeCompatibility(value, label = "Oven runtimeCompatibility") {
  if (typeof value !== "string" || !compatibilityPattern.test(value)) {
    throw new Error(`${label} must be a Burnlist Oven runtime contract.`);
  }
  return value;
}

export function assertSupportedOvenRuntime(value, label = "Oven runtimeCompatibility") {
  const compatibility = ovenRuntimeCompatibility(value, label);
  if (compatibility !== OVEN_RUNTIME_COMPATIBILITY) {
    throw new Error(
      `${label} ${compatibility} is incompatible with installed runtime ${OVEN_RUNTIME_COMPATIBILITY}.`,
    );
  }
  return compatibility;
}
