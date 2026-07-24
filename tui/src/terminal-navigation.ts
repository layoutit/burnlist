export type GlobalKeyAction = "back" | "exit" | "input" | "continue";

/** An explicit text mode owns printable keys; q remains the back key only outside it. */
export function terminalKeyAction(key: string | undefined, depth: number, textInputFocused: boolean): GlobalKeyAction {
  if (textInputFocused && key === "escape") return "continue";
  if (textInputFocused && !!key && key.length === 1) return "input";
  if (key === "q") return "back";
  if (key === "escape") return depth <= 1 ? "exit" : "back";
  return textInputFocused && !!key && key.length === 1 ? "input" : "continue";
}
