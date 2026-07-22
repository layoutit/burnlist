import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "../Badge";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "./Table";

const rows = [
  { project: "dashboard", title: "Observer layout", status: "Active", progress: "27 / 31" },
  { project: "adapter-kit", title: "Contract acceptance", status: "Ready", progress: "8 / 8" },
  { project: "render-lab", title: "Release readiness", status: "Draft", progress: "3 / 9" },
];

const meta = {
  title: "UI/Table",
  component: Table,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Burnlists = {
  render: () => (
    <div className="storybook-table-demo">
      <Table>
        <TableCaption>Local Burnlists discovered across configured repositories.</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Project</TableHead>
            <TableHead scope="col">Burnlist</TableHead>
            <TableHead scope="col">Status</TableHead>
            <TableHead scope="col">Progress</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.title}>
              <TableCell>{row.project}</TableCell>
              <TableCell>{row.title}</TableCell>
              <TableCell><Badge variant="outline">{row.status}</Badge></TableCell>
              <TableCell>{row.progress}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
} satisfies Story;
