import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { CatalogApp } from "./catalog-app";
import { TerminalAccessibilityProvider, terminalAccessibility } from "../terminal-accessibility";
import { TerminalChromeProvider } from "../terminal-chrome";

const renderer = await createCliRenderer({ backgroundColor: "transparent", exitOnCtrlC: false, targetFps: 30, maxFps: 60, screenMode: "alternate-screen" });
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
try { root.render(<TerminalAccessibilityProvider value={terminalAccessibility(process.env)}><TerminalChromeProvider><CatalogApp shutdown={shutdown} /></TerminalChromeProvider></TerminalAccessibilityProvider>); } catch (error) { renderer.destroy(); throw error; }
