import { expect, test } from "bun:test";
import { nativeImageMode } from "./native-image-capability";

test("native image capability fails safely when VS Code image support is unknowable", () => {
  expect(nativeImageMode({ TERM_PROGRAM: "vscode" })).toBe("glyph");
  expect(nativeImageMode({ TERM_PROGRAM: "vscode", BURNLIST_NATIVE_IMAGES: "0" })).toBe("glyph");
  expect(nativeImageMode({ TERM_PROGRAM: "vscode", BURNLIST_NATIVE_IMAGES: "1" })).toBe("iterm");
});

test("known OSC 1337 terminals use native images unless explicitly disabled", () => {
  expect(nativeImageMode({ TERM_PROGRAM: "iTerm.app" })).toBe("iterm");
  expect(nativeImageMode({ TERM_PROGRAM: "WezTerm" })).toBe("iterm");
  expect(nativeImageMode({ TERM_PROGRAM: "Apple_Terminal" })).toBe("glyph");
  expect(nativeImageMode({ TERM_PROGRAM: "iTerm.app", BURNLIST_NATIVE_IMAGES: "0" })).toBe("glyph");
});
