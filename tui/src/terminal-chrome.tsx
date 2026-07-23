import { CliRenderEvents, type TerminalColors } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface TerminalChrome {
  background: string;
  header: string;
  surface: string;
  line: string;
  faintLine: string;
}

const fallback: TerminalChrome = {
  background: "transparent",
  header: "transparent",
  surface: "#202024",
  line: "#3a3a40",
  faintLine: "#29292e",
};

function rgb(hex: string | null, defaultValue: [number, number, number]): [number, number, number] {
  const match = /^#?([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})/iu.exec(hex ?? "");
  return match ? [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)] : defaultValue;
}

function mix(background: [number, number, number], foreground: [number, number, number], amount: number): string {
  return `#${background.map((value, index) => Math.round(value + (foreground[index]! - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}

export function terminalChrome(colors: TerminalColors | null | undefined): TerminalChrome {
  if (!colors?.defaultBackground) return fallback;
  const background = rgb(colors.defaultBackground, [24, 24, 27]);
  const foreground = rgb(colors.defaultForeground, [220, 220, 224]);
  return {
    background: "transparent",
    header: "transparent",
    surface: mix(background, foreground, 0.07),
    line: mix(background, foreground, 0.18),
    faintLine: mix(background, foreground, 0.10),
  };
}

const ChromeContext = createContext<TerminalChrome>(fallback);

export function TerminalChromeProvider({ children }: { children: ReactNode }) {
  const renderer = useRenderer();
  const [chrome, setChrome] = useState(fallback);
  useEffect(() => {
    let active = true;
    const apply = (colors: TerminalColors) => { if (active) setChrome(terminalChrome(colors)); };
    renderer.on(CliRenderEvents.PALETTE, apply);
    void renderer.getPalette({ timeout: 250, size: 16 }).then(apply).catch(() => {});
    return () => {
      active = false;
      renderer.off(CliRenderEvents.PALETTE, apply);
    };
  }, [renderer]);
  return <ChromeContext.Provider value={chrome}>{children}</ChromeContext.Provider>;
}

export function useTerminalChrome(): TerminalChrome {
  return useContext(ChromeContext);
}
