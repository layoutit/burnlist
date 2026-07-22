import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "./Checkbox";

const meta = {
  title: "UI/Checkbox",
  component: Checkbox,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive = {
  render: () => {
    const [checked, setChecked] = useState(false);
    return (
      <label className="storybook-checkbox-row">
        <Checkbox checked={checked} onCheckedChange={(value) => setChecked(value === true)} />
        Include completed Burnlists
      </label>
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
