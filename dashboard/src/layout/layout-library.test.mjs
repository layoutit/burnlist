import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const layoutRoot = fileURLToPath(new URL(".", import.meta.url));
const componentNames = [
  "Alert",
  "Badge",
  "Button",
  "Card",
  "Checkbox",
  "Field",
  "Input",
  "Progress",
  "Select",
  "Separator",
  "Skeleton",
  "Spinner",
  "Table",
  "Tabs",
  "Textarea",
  "ToggleGroup",
  "Tooltip",
];

test("the layout barrel exposes every documented primitive", async () => {
  const barrel = await readFile(new URL("index.ts", import.meta.url), "utf8");

  for (const name of componentNames) {
    assert.match(barrel, new RegExp(`from ["']\\./${name}["']`), `${name} is missing from the layout barrel`);
  }
});

test("every primitive has a named implementation, index, and Storybook story", async () => {
  for (const name of componentNames) {
    const directory = new URL(`./${name}/`, import.meta.url);
    const source = await readFile(new URL(`${name}.tsx`, directory), "utf8");

    await stat(new URL("index.ts", directory));
    await stat(new URL(`${name}.stories.tsx`, directory));
    assert.doesNotMatch(source, /export\s+default/, `${name} must use named exports`);
    assert.doesNotMatch(source, /from\s+["']@(components|hooks|oven)/, `${name} crosses the layout dependency boundary`);
  }
});

test("layout source files stay within the repository size limit", async () => {
  const pending = [layoutRoot];

  while (pending.length) {
    const directory = pending.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (/\.(css|mjs|ts|tsx)$/.test(entry.name)) {
        const source = await readFile(path, "utf8");
        assert.ok(source.split("\n").length <= 400, `${path} exceeds 400 lines`);
      }
    }
  }
});

test("Storybook uses the dashboard surface and container-bound demo widths", async () => {
  const preview = await readFile(new URL("../../.storybook/preview.ts", import.meta.url), "utf8");
  const styles = await readFile(new URL("../../.storybook/storybook.css", import.meta.url), "utf8");
  const formControls = await readFile(new URL("form-controls.css", import.meta.url), "utf8");
  const differentialStyles = await readFile(new URL("../components/DifferentialTesting/differential-testing.css", import.meta.url), "utf8");

  assert.match(preview, /backgrounds:\s*\{\s*value:\s*["']burnlist["']/);
  assert.match(preview, /burnlist:\s*\{\s*name:\s*["']Burnlist["'],\s*value:\s*["']#000000["']/);
  assert.match(preview, /docs:\s*\{\s*theme:\s*burnlistDocsTheme/);
  assert.match(styles, /\.sbdocs-wrapper\s*\{/);
  assert.match(styles, /\.docs-story\s*\{/);
  assert.doesNotMatch(styles, /100vw/, "story demos must size against their preview container");
  assert.match(formControls, /::placeholder\s*\{\s*color:\s*rgba\(168,\s*168,\s*168,\s*\.74\)/);
  assert.match(differentialStyles, /#differential-overview-time\s*\{[^}]*color:\s*var\(--muted\)/s);
  assert.match(differentialStyles, /--driving-parity-kpi-red-label:\s*var\(--red\)/);
  assert.match(differentialStyles, /\.hybrid-row\.fail \.hybrid-status\s*\{\s*color:\s*var\(--red\)/);
  assert.match(differentialStyles, /\.hybrid-row:focus-visible\s*\{/);
});

test("Storybook exposes the source-backed top card and field-list card patterns", async () => {
  const topCard = await readFile(new URL("../oven/runtime/differential-testing-detail.stories.tsx", import.meta.url), "utf8");
  const fieldList = await readFile(new URL("../oven/HybridFieldList/HybridFieldList.stories.tsx", import.meta.url), "utf8");
  const fixture = await readFile(new URL("../oven/storybook-differential-fixture.ts", import.meta.url), "utf8");

  assert.match(topCard, /title:\s*["']Patterns\/TopCard["']/);
  assert.match(topCard, /<DifferentialTestingDetail/);
  assert.match(topCard, /<DifferentialKpiStrip/);
  assert.match(topCard, /<DifferentialLogTable/);
  assert.match(topCard, /<FieldMiniChart/);
  assert.match(fieldList, /title:\s*["']Patterns\/FieldListCards["']/);
  assert.match(fieldList, /<HybridFieldList/);
  assert.match(fixture, /reference-fixture \/ candidate-fixture/);
  assert.match(topCard, /DifferentialTesting\/differential-testing\.css/);
  assert.match(fieldList, /DifferentialTesting\/differential-testing\.css/);
});

test("Storybook's development runtime is documented and verified on a supported CI lane", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8"));
  const readme = await readFile(new URL("../../../README.md", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");

  assert.equal(packageJson.engines?.node, ">=18", "Storybook must not raise the shipped Burnlist runtime floor");
  assert.match(readme, /Storybook\s+10 development commands require Node\.js 20\.19\+ or 22\.12\+/);
  assert.match(workflow, /- name: Build Storybook\s+if: matrix\.node-version == 22\s+run: npm run build:storybook/);
});
