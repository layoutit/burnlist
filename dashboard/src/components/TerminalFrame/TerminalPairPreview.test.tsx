import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PairPreview } from "./TerminalPairPreview";

describe("live paired Storybook preview", () => {
  test("the same changed arg appears in both web and terminal panes", () => {
    const render = (label: string, variant: string) => renderToStaticMarkup(
      <PairPreview component="badge" terminalArgs={{ label, variant }}>
        <span data-console-value={label}>{label}</span>
      </PairPreview>,
    );
    const active = render("active", "default"), blocked = render("blocked", "destructive");
    expect(active).toContain("data-console-value=\"active\"");
    expect(active).toContain("[ active ]");
    expect(blocked).toContain("data-console-value=\"blocked\"");
    expect(blocked).toContain("[ blocked ]");
    expect(blocked).not.toBe(active);
  });

  test("Alert controls change both web text and terminal semantic rendering", () => {
    const markup = renderToStaticMarkup(
      <PairPreview component="alert" terminalArgs={{ variant: "warning", title: "Evidence stale", detail: "Refresh it." }}>
        <div data-console-variant="warning">Evidence stale</div>
      </PairPreview>,
    );
    expect(markup).toContain("data-console-variant=\"warning\"");
    expect(markup).toContain("! Evidence stale");
    expect(markup).toContain("#fcd34d");
  });
});
