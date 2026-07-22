import { fileURLToPath, URL } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

const sourceDir = fileURLToPath(new URL("../src", import.meta.url));

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  core: {
    disableTelemetry: true,
  },
  async viteFinal(viteConfig) {
    const { mergeConfig } = await import("vite");

    return mergeConfig(viteConfig, {
      resolve: {
        alias: {
          "@": sourceDir,
          "@layout": fileURLToPath(new URL("../src/layout", import.meta.url)),
          "@components": fileURLToPath(new URL("../src/components", import.meta.url)),
          "@hooks": fileURLToPath(new URL("../src/hooks", import.meta.url)),
          "@lib": fileURLToPath(new URL("../src/lib", import.meta.url)),
          "@oven": fileURLToPath(new URL("../src/oven", import.meta.url)),
        },
      },
    });
  },
};

export default config;
