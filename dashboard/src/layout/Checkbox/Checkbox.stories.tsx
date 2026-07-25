import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { Checkbox } from "./Checkbox";

const fixture = componentPairFixture.checkbox;
const meta = {
  title: "UI/Checkbox",
  component: Checkbox,
  args: { checked: fixture.checked, disabled: false, label: fixture.label },
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive = {
  render: (args) => {
    const [checked, setChecked] = useState(Boolean(args.checked));
    useEffect(() => setChecked(Boolean(args.checked)), [args.checked]);
    return (
      <PairPreview component="checkbox" terminalArgs={{ ...args, checked }}>
        <label className="storybook-checkbox-row">
          <Checkbox aria-label="Include completed Burnlists" checked={checked} disabled={Boolean(args.disabled)} onCheckedChange={(value) => setChecked(value === true)} />
          {String(args.label)}
        </label>
      </PairPreview>
    );
  },
} satisfies Story;

export const States = {
  render: () => (
    <div className="storybook-stack">
      <label className="storybook-checkbox-row"><Checkbox /> Unchecked</label>
      <label className="storybook-checkbox-row"><Checkbox defaultChecked /> Checked</label>
      <label className="storybook-checkbox-row"><Checkbox checked="indeterminate" /> Indeterminate</label>
      <label className="storybook-checkbox-row"><Checkbox disabled /> Disabled</label>
      <label className="storybook-checkbox-row"><Checkbox defaultChecked disabled /> Checked and disabled</label>
    </div>
  ),
} satisfies Story;
