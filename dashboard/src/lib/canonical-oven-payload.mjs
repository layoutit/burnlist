export function validatedOvenPayload(raw, name) {
  if (!raw || typeof raw !== "object" || raw.validated !== true || !("payload" in raw)) {
    throw new Error(`${name} data was not validated by the Oven.`);
  }
  return raw.payload;
}
