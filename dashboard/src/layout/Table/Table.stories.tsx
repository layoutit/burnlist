import type { Meta, StoryObj } from "@storybook/react-vite";
import { PairPreview } from "../../components/TerminalFrame/TerminalPairPreview";
import { componentPairFixture } from "../../../../tui/src/catalog/component-pair-fixture";
import { Badge } from "../Badge";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "./Table";

const fixture = componentPairFixture.table;

const meta = {
  title: "UI/Table",
  component: Table,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Burnlists = {
  render: () => (
    <PairPreview component="table">
      <div className="storybook-table-demo">
        <Table>
          <TableCaption>{fixture.caption}</TableCaption>
          <TableHeader><TableRow>{fixture.headers.map((header) => <TableHead key={header} scope="col">{header}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {fixture.rows.map((row) => (
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
    </PairPreview>
  ),
} satisfies Story;
