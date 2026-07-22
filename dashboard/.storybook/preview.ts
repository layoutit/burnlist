import type { Preview } from "@storybook/react-vite";
import { create } from "storybook/theming";
import "../src/layout/primitives.css";
import "./storybook.css";

const burnlistDocsTheme = create({
  base: "dark",
  colorPrimary: "#5aa2ff",
  colorSecondary: "#5aa2ff",
  appBg: "#000000",
  appContentBg: "#000000",
  appHoverBg: "#1c1c1c",
  appPreviewBg: "#000000",
  appBorderColor: "#262626",
  appBorderRadius: 4,
  fontBase: '"Helvetica Neue", Helvetica, ui-sans-serif, system-ui, sans-serif',
  fontCode: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  textColor: "#e8e8e8",
  textInverseColor: "#000000",
  textMutedColor: "#a8a8a8",
  barTextColor: "#a8a8a8",
  barHoverColor: "#e8e8e8",
  barSelectedColor: "#e8e8e8",
  barBg: "#050505",
  buttonBg: "#111111",
  buttonBorder: "#262626",
  booleanBg: "#1a1a1a",
  booleanSelectedBg: "#111111",
  inputBg: "#111111",
  inputBorder: "#262626",
  inputTextColor: "#e8e8e8",
  inputBorderRadius: 4,
});

const preview: Preview = {
  initialGlobals: {
    backgrounds: { value: "burnlist", grid: false },
  },
  parameters: {
    backgrounds: {
      options: {
        burnlist: { name: "Burnlist", value: "#000000" },
      },
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    docs: {
      theme: burnlistDocsTheme,
    },
    layout: "centered",
    options: {
      storySort: {
        order: ["Foundations", "UI", "Patterns"],
      },
    },
  },
  tags: ["autodocs"],
};

export default preview;
