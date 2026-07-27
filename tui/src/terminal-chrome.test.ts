import { describe, expect, test } from "bun:test";
import { terminalChrome } from "./terminal-chrome";

const colors = {
  palette: [], defaultForeground: "#d4d4d4", defaultBackground: "#181818", cursorColor: null,
  mouseForeground: null, mouseBackground: null, tekForeground: null, tekBackground: null,
  highlightBackground: null, highlightForeground: null,
};

describe("terminal-native chrome", () => {
  test("leaves the host background transparent and derives its dividers", () => {
    const chrome = terminalChrome(colors);
    expect(chrome.background).toBe("transparent");
    expect(chrome.header).toBe("transparent");
    expect(chrome.line).toMatch(/^#[a-f0-9]{6}$/u);
    expect(chrome.line).not.toBe("#3a3a40");
    expect(chrome.surface).not.toBe(colors.defaultBackground);
  });

  test("falls back safely when the terminal does not answer palette queries", () => {
    expect(terminalChrome(null).background).toBe("transparent");
    expect(terminalChrome(null).line).toBe("#3a3a40");
  });
});
