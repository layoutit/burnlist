import type { Meta, StoryObj } from "@storybook/react-vite";

const palette = [
  { name: "Background", value: "#000000" },
  { name: "Panel", value: "#111111" },
  { name: "Accent", value: "#1c1c1c" },
  { name: "Border", value: "#262626" },
  { name: "Foreground", value: "#e8e8e8" },
  { name: "Muted", value: "#a8a8a8" },
  { name: "Active / focus", value: "#5aa2ff" },
  { name: "Success", value: "#61d394" },
  { name: "Destructive", value: "#ef4444" },
];

const meta = {
  title: "Foundations/Visual language",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Palette = {
  render: () => (
    <div className="storybook-foundations">
      <section>
        <h2>Palette</h2>
        <div className="storybook-swatch-grid">
          {palette.map((token) => (
            <div className="storybook-swatch" key={token.name}>
              <div className="storybook-swatch-color" style={{ background: token.value }} />
              <div className="storybook-swatch-copy">
                <span className="storybook-swatch-name">{token.name}</span>
                <span className="storybook-swatch-value">{token.value}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  ),
} satisfies Story;

export const Typography = {
  render: () => (
    <div className="storybook-foundations">
      <section>
        <h2>Typography</h2>
        <div className="storybook-swatch">
          <div className="storybook-type-sample">
            <span className="storybook-type-title">Burnlists</span>
            <span className="storybook-type-meta">Local/system sans · titles and controls · weight 400</span>
          </div>
          <div className="storybook-type-sample">
            <span className="storybook-type-data">frame 184 · exact mismatch · 0.00390625</span>
            <span className="storybook-type-meta">System monospace · data and evidence · weight 400</span>
          </div>
        </div>
      </section>
    </div>
  ),
} satisfies Story;
