import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { Badge } from "../Badge";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "./Table";

const fixture = componentPairFixture.table;

const meta = {
  title: "UI/Table",
  component: Table,
  args: { caption: fixture.caption, headers: fixture.headers, rows: fixture.rows },
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Burnlists = {
  render: (args) => {
    const headers = Array.isArray(args.headers) ? args.headers.map(String) : [...fixture.headers];
    const rows = Array.isArray(args.rows) ? args.rows as unknown as string[][] : fixture.rows.map((row) => [...row]);
    return <PairPreview component="table" terminalArgs={{ ...args, headers, rows }}>
      <div className="storybook-table-demo">
        <Table>
          <TableCaption>{String(args.caption)}</TableCaption>
          <TableHeader><TableRow>{headers.map((header) => <TableHead key={header} scope="col">{header}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row[1]}>
                <TableCell>{row[0]}</TableCell>
                <TableCell>{row[1]}</TableCell>
                <TableCell><Badge variant="outline">{row[2]}</Badge></TableCell>
                <TableCell>{row[3]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </PairPreview>;
  },
} satisfies Story;
