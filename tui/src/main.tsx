import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app";
import { TerminalAccessibilityProvider, terminalAccessibility } from "./terminal-accessibility";

async function serverUrl(): Promise<string> {
  const index = process.argv.indexOf("--server");
  if (index >= 0) {
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--server requires a URL.");
    return value;
  }
  try {
    const runtime = JSON.parse(await readFile(join(homedir(), ".burnlist", "server.json"), "utf8"));
    if (typeof runtime.url === "string") return runtime.url;
  } catch {
    // The regular default remains useful when no runtime record exists yet.
  }
  return "http://127.0.0.1:4510";
}

const renderer = await createCliRenderer({
  backgroundColor: "transparent",
  exitOnCtrlC: false,
  targetFps: 30,
  maxFps: 60,
  screenMode: "alternate-screen",
});
const root = createRoot(renderer);
let closing = false;

function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  renderer.destroy();
  setTimeout(() => process.exit(code), 0);
}

process.once("SIGINT", () => shutdown(130));
process.once("SIGTERM", () => shutdown(143));

try {
  root.render(<TerminalAccessibilityProvider value={terminalAccessibility(process.env)}><App serverUrl={await serverUrl()} shutdown={shutdown} /></TerminalAccessibilityProvider>);
} catch (error) {
  renderer.destroy();
  throw error;
}
