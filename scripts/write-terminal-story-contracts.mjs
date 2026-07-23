#!/usr/bin/env node
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverStorybook } from "./terminal-oven-parity-source.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dashboard/src/terminal-parity/story-contracts.json");
const action = (row) => ({ id: row.id, expectedConsoleOutcome: row.expectedConsoleOutcome, ...(row.consoleOperationTarget ? { consoleOperationTarget: row.consoleOperationTarget } : {}), terminal: { status: "gap", missing: `No terminal counterpart for ${row.id}.` } });

function states(story) {
  const guarded = story.controls.filter((row) => row.guard).map((row) => row.id);
  return story.stateMatrix.flatMap((source) => {
    const common = { storyExport: story.export, sourceFingerprint: story.fingerprint, ...Object.fromEntries(Object.entries(story.args).filter(([, value]) => value !== undefined).map(([key, value]) => [`arg.${key}`, String(value)])), ...source.sourceState };
    if (!guarded.length) return [{ id: source.id, sourceState: common, actions: source.actions.map(action) }];
    const present = Object.fromEntries(guarded.map((id) => [id, true]));
    const absent = Object.fromEntries(guarded.map((id) => [id, false]));
    return [
      { id: `${source.id}-guards-present`, sourceState: { ...common, guards: "present" }, guardBindings: present, actions: source.actions.map(action) },
      { id: `${source.id}-guards-absent`, sourceState: { ...common, guards: "absent" }, guardBindings: absent, actions: source.actions.filter((row) => !row.guard).map(action) },
    ];
  });
}

const stories = await discoverStorybook(root);
const text = `${JSON.stringify({ schema: "burnlist-terminal-story-contracts@4", stories: stories.map((story) => ({ id: story.id, states: states(story) })) }, null, 2)}\n`;
const temp = `${output}.${process.pid}.tmp`;
await mkdir(dirname(output), { recursive: true });
try { await writeFile(temp, text); await rename(temp, output); } finally { await unlink(temp).catch(() => {}); }
