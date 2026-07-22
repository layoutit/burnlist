import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card, CardContent, CardHeader } from "../Card";
import { Skeleton } from "./Skeleton";

const meta = {
  title: "UI/Skeleton",
  component: Skeleton,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CardLoading = {
  render: () => (
    <Card aria-label="Loading Burnlist summary" aria-busy="true" className="storybook-card-demo" role="status">
      <CardHeader>
        <Skeleton className="storybook-skeleton-title" />
        <Skeleton className="storybook-skeleton-copy" />
      </CardHeader>
      <CardContent className="storybook-stack">
        <Skeleton className="storybook-skeleton-row" />
        <Skeleton className="storybook-skeleton-row" />
        <Skeleton className="storybook-skeleton-row storybook-skeleton-row-short" />
      </CardContent>
    </Card>
  ),
} satisfies Story;
