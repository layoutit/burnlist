export type NativeImageMode = "iterm" | "glyph";

/**
 * OSC 1337 has no capability query. VS Code also does not expose its
 * terminal.integrated.enableImages setting to child processes, so an
 * unqualified VS Code session must stay on the lossless glyph fallback.
 * Users who enabled the setting can opt in with BURNLIST_NATIVE_IMAGES=1.
 */
export function nativeImageMode(env: Readonly<Record<string, string | undefined>>): NativeImageMode {
  const override = env.BURNLIST_NATIVE_IMAGES;
  if (override === "0") return "glyph";
  if (override === "1") return "iterm";
  return ["iTerm.app", "WezTerm"].includes(env.TERM_PROGRAM ?? "") ? "iterm" : "glyph";
}
