import { describe, expect, test } from "bun:test";
import {
  agentMonitorFeedKey,
  agentMonitorFeedLabel,
  agentMonitorFeedQuery,
  moveAgentMonitorFeed,
  selectAgentMonitorFeed,
  type AgentMonitorFeed,
} from "./agent-monitor-navigation";

const feed = (session: string): AgentMonitorFeed => ({
  identity: { logicalRepoKey: "repo-a", worktreeKey: "worktree-a", session },
  updatedAt: "2026-07-27T12:00:00.000Z",
  href: `/session/${session}`,
  title: session,
  detail: session,
  state: "Live",
});

describe("Agent Monitor terminal navigation", () => {
  test("retains an exact session while a refreshed feed list is reordered", () => {
    const retained = agentMonitorFeedKey(feed("claude:second"));
    const navigation = selectAgentMonitorFeed([feed("claude:first"), feed("claude:second")], retained);
    expect(navigation.selected).toBe(1);
    expect(agentMonitorFeedQuery(navigation)).toEqual({ worktreeKey: "worktree-a", session: "claude:second" });
  });

  test("cycles sessions without changing the Oven's own controls", () => {
    const initial = selectAgentMonitorFeed([feed("codex:first"), feed("claude:second")], null);
    expect(initial.selected).toBe(-1);
    expect(agentMonitorFeedQuery(initial)).toEqual({ aggregate: 1 });
    expect(agentMonitorFeedLabel(initial)).toContain("All sessions · 2 observed");
    const moved = moveAgentMonitorFeed(initial, 1);
    expect(moved.selected).toBe(0);
    expect(agentMonitorFeedLabel(moved)).toContain("1/2 · codex");
    expect(moveAgentMonitorFeed(moveAgentMonitorFeed(moved, 1), 1).selected).toBe(-1);
  });
});
