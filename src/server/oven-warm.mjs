// Background Oven warming is opportunistic: data refresh failures must never
// prevent startup or escape an interval callback.
export function warmOvenHandler(handler, resolveBindings, createContext) {
  try {
    const ovenDataBindings = resolveBindings();
    if (!ovenDataBindings.has(handler.id)) return;
    handler.warm(createContext({ id: handler.id, ovenDataBindings }));
  } catch {
    // Request routes report data failures; background warming stays silent.
  }
}
