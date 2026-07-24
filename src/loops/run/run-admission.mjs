import { operationCompletedPayload } from "./operation.mjs";
import { createJournalRecord } from "./run-journal.mjs";
import { MAX_CATALOG_JOURNAL_BYTES, MAX_RUN_JOURNAL_BYTES, fail } from "./run-codec.mjs";
import { foldStateMachine } from "./state-machine.mjs";

function next(previous, type, payload) {
  return createJournalRecord({ schema: "burnlist-loop-journal@1", sequence: previous.value.sequence + 1,
    prevDigest: previous.digest, type, artifacts: [], payload });
}

export function assertJournalCapacity({ runBytes, catalogBytes, recordBytes,
  runLimit = MAX_RUN_JOURNAL_BYTES, catalogLimit = MAX_CATALOG_JOURNAL_BYTES }) {
  if (![runBytes, catalogBytes, recordBytes, runLimit, catalogLimit].every((value) => Number.isSafeInteger(value) && value >= 0))
    fail("invalid journal capacity accounting");
  if (runBytes + recordBytes > runLimit || catalogBytes + recordBytes > catalogLimit)
    fail("journal publication would exceed replay bounds");
}

/** Proves one append and any declared operation continuation before bytes are published. */
export function admitAppend({ current, type, payload, artifacts, catalogBytes }) {
  if (type === "run-created") fail("Run creation cannot be appended");
  const prospective = createJournalRecord({ schema: "burnlist-loop-journal@1",
    sequence: current.projection.sequence + 1, prevDigest: current.projection.journalDigest, type, artifacts, payload });
  const runBytes = current.journal.reduce((total, record) => total + record.bytes.length, 0);
  assertJournalCapacity({ runBytes, catalogBytes, recordBytes: prospective.bytes.length });
  let records = [...current.journal, prospective];
  if (type === "operation-intent") {
    let previous = prospective;
    for (const step of payload.steps) { previous = next(previous, step.type, step.payload); records.push(previous); }
    previous = next(previous, "operation-completed", operationCompletedPayload(payload.operationId)); records.push(previous);
    const result = foldStateMachine({ ir: current.frozenRecipe.ir, records });
    if (result.state !== payload.targetState) fail("operation target state does not match its exact steps");
  } else foldStateMachine({ ir: current.frozenRecipe.ir, records });
  return prospective;
}
