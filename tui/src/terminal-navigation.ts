export type GlobalKeyAction = "back" | "exit" | "input" | "continue";

/** Global keys win over nested controls: q always backs; Escape exits only home. */
export function terminalKeyAction(key: string | undefined, depth: number, textInputFocused: boolean): GlobalKeyAction {
  if (key === "q") return "back";
  if (key === "escape") return depth <= 1 ? "exit" : "back";
  return textInputFocused && !!key && key.length === 1 ? "input" : "continue";
}
