import assert from "node:assert/strict";
import test from "node:test";
import { assertJournalCapacity } from "./run-admission.mjs";

test("prospective Run and catalog journal bounds admit the exact boundary only", () => {
  assert.doesNotThrow(() => assertJournalCapacity({
    runBytes: 7, catalogBytes: 17, recordBytes: 3, runLimit: 10, catalogLimit: 20,
  }));
  assert.throws(() => assertJournalCapacity({
    runBytes: 8, catalogBytes: 17, recordBytes: 3, runLimit: 10, catalogLimit: 20,
  }), /replay bounds/u);
  assert.throws(() => assertJournalCapacity({
    runBytes: 7, catalogBytes: 18, recordBytes: 3, runLimit: 10, catalogLimit: 20,
  }), /replay bounds/u);
  assert.throws(() => assertJournalCapacity({
    runBytes: -1, catalogBytes: 0, recordBytes: 1, runLimit: 10, catalogLimit: 20,
  }), /capacity accounting/u);
});
