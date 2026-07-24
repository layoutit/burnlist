/** B6-only, content-addressed offscreen-harness record. B1 accepts no records. */
export type TerminalActionAnnotation = Readonly<{ recordId: string; actionId: string }>;
export type TerminalEvidence = Readonly<{ recordId: string; target: string }>;
export type TerminalAtomMapping = Readonly<{ atomId: string; evidence: TerminalEvidence }>;
export type TerminalCapabilityClaim = Readonly<{ sourceFamilyId: string; implementationExport: string; fixtureIds: readonly string[]; atomMappings: readonly [TerminalAtomMapping] }>;

/**
 * The terminal's actual key surface.  This is deliberately separate from
 * inventory claims: a console control is only mapped below after its semantics,
 * fixture and this concrete action agree.  Keeping gaps honest prevents a
 * broad "enter works" claim from silently covering unrelated controls.
 */
export const TERMINAL_OVEN_ACTIONS: readonly TerminalActionAnnotation[] = Object.freeze([]);

/**
 * Closed reviewed source of terminal capability claims.  The keys are terminal
 * affordances; each claim pins the console semantic owner and the terminal
 * behavior proof instead of treating a renderer name as sufficient evidence.
 */
export const TERMINAL_OVEN_CAPABILITIES: readonly TerminalCapabilityClaim[] = Object.freeze([
  {
  sourceFamilyId: "grammar:element:box",
  implementationExport: "tui/src/oven-runtime/layout/structural-viewport.tsx#StructuralOvenViewport",
  fixtureIds: ["structural-layout"],
  atomMappings: [{ atomId: "grammar:element:box", evidence: { recordId: "structural-layout:grammar:element:box", target: "atom:grammar:element:box" } }],
  }, {
  sourceFamilyId: "compiled:element:box",
  implementationExport: "tui/src/oven-runtime/layout/structural-viewport.tsx#StructuralOvenViewport",
  fixtureIds: ["structural-layout"],
  atomMappings: [{ atomId: "compiled:element:box", evidence: { recordId: "structural-layout:compiled:element:box", target: "atom:compiled:element:box" } }],
  }, {
  sourceFamilyId: "grammar:element:grid",
  implementationExport: "tui/src/oven-runtime/layout/structural-viewport.tsx#StructuralOvenViewport",
  fixtureIds: ["structural-layout"],
  atomMappings: [{ atomId: "grammar:element:grid", evidence: { recordId: "structural-layout:grammar:element:grid", target: "atom:grammar:element:grid" } }],
  }, {
  sourceFamilyId: "compiled:element:grid",
  implementationExport: "tui/src/oven-runtime/layout/structural-viewport.tsx#StructuralOvenViewport",
  fixtureIds: ["structural-layout"],
  atomMappings: [{ atomId: "compiled:element:grid", evidence: { recordId: "structural-layout:compiled:element:grid", target: "atom:compiled:element:grid" } }],
  }, {
  sourceFamilyId: "grammar:element:stack",
  implementationExport: "tui/src/oven-runtime/layout/structural-viewport.tsx#StructuralOvenViewport",
  fixtureIds: ["structural-layout"],
  atomMappings: [{ atomId: "grammar:element:stack", evidence: { recordId: "structural-layout:grammar:element:stack", target: "atom:grammar:element:stack" } }],
  }, {
  sourceFamilyId: "compiled:element:stack",
  implementationExport: "tui/src/oven-runtime/layout/structural-viewport.tsx#StructuralOvenViewport",
  fixtureIds: ["structural-layout"],
  atomMappings: [{ atomId: "compiled:element:stack", evidence: { recordId: "structural-layout:compiled:element:stack", target: "atom:compiled:element:stack" } }],
  }, {
  sourceFamilyId: "grammar:element:panel",
  implementationExport: "tui/src/oven-runtime/layout/structural-viewport.tsx#StructuralOvenViewport",
  fixtureIds: ["structural-layout"],
  atomMappings: [{ atomId: "grammar:element:panel", evidence: { recordId: "structural-layout:grammar:element:panel", target: "atom:grammar:element:panel" } }],
  }, {
  sourceFamilyId: "compiled:element:panel",
  implementationExport: "tui/src/oven-runtime/layout/structural-viewport.tsx#StructuralOvenViewport",
  fixtureIds: ["structural-layout"],
  atomMappings: [{ atomId: "compiled:element:panel", evidence: { recordId: "structural-layout:compiled:element:panel", target: "atom:compiled:element:panel" } }],
  }, {
  sourceFamilyId: "grammar:element:text",
  implementationExport: "tui/src/oven-runtime/layout/structural-viewport.tsx#StructuralOvenViewport",
  fixtureIds: ["structural-layout"],
  atomMappings: [{ atomId: "grammar:element:text", evidence: { recordId: "structural-layout:grammar:element:text", target: "atom:grammar:element:text" } }],
  }, {
  sourceFamilyId: "compiled:element:text",
  implementationExport: "tui/src/oven-runtime/layout/structural-viewport.tsx#StructuralOvenViewport",
  fixtureIds: ["structural-layout"],
  atomMappings: [{ atomId: "compiled:element:text", evidence: { recordId: "structural-layout:compiled:element:text", target: "atom:compiled:element:text" } }],
  }, {
  sourceFamilyId: "grammar:element:icon",
  implementationExport: "tui/src/oven-runtime/layout/structural-viewport.tsx#StructuralOvenViewport",
  fixtureIds: ["structural-layout"],
  atomMappings: [{ atomId: "grammar:element:icon", evidence: { recordId: "structural-layout:grammar:element:icon", target: "atom:grammar:element:icon" } }],
  }, {
  sourceFamilyId: "compiled:element:icon",
  implementationExport: "tui/src/oven-runtime/layout/structural-viewport.tsx#StructuralOvenViewport",
  fixtureIds: ["structural-layout"],
  atomMappings: [{ atomId: "compiled:element:icon", evidence: { recordId: "structural-layout:compiled:element:icon", target: "atom:compiled:element:icon" } }],
  },
]);
