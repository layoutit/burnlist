/** B6-only, content-addressed offscreen-harness record. B1 accepts no records. */
export type TerminalActionAnnotation = Readonly<{ recordId: string; actionId: string }>;
export type TerminalEvidence = Readonly<{ recordId: string; target: string; artifactSha256: string; sourceSha256: string; viewport: Readonly<{ width: number; height: number }>; initialContext: string; inputSequence: readonly string[]; beforeFrameSha256: string; afterFrameSha256: string; operationTarget?: string; generator: "burnlist-b6-offscreen@1" }>;
export type TerminalAtomMapping = Readonly<{ atomId: string; terminalActionId?: string; operationTarget?: string; evidence?: TerminalEvidence }>;
export type TerminalCapabilityClaim = Readonly<{ sourceFamilyId: string; implementationExport: string; fixtureIds: readonly string[]; atomMappings: readonly TerminalAtomMapping[] }>;

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
export const TERMINAL_OVEN_CAPABILITIES: readonly TerminalCapabilityClaim[] = Object.freeze([]);
