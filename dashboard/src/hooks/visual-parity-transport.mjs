export function receiveVisualParity(response, json) {
  if (!response.ok) throw new Error(json.error ?? "Could not load Visual Parity.");
  if (json.validated !== true) throw new Error("Visual Parity data was not validated by the Oven.");
  return json.payload;
}
