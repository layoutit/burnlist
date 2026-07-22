import assert from "node:assert/strict";
import test from "node:test";
import { officialOvenSampleAllowed } from "./oven-sample-policy.mjs";

const official = {
  id: "checklist",
  origin: "official",
  ovenRevision: "o1-sha256:current",
};

test("official samples are limited to official or byte-matching vendored revisions", () => {
  assert.equal(officialOvenSampleAllowed(official, [official]), true);
  assert.equal(officialOvenSampleAllowed({
    ...official,
    origin: "vendored",
    repoKey: "aaaaaaaaaaaa",
  }, [official]), true);
  assert.equal(officialOvenSampleAllowed({
    ...official,
    origin: "vendored",
    ovenRevision: "o1-sha256:older",
    repoKey: "aaaaaaaaaaaa",
  }, [official]), false);
  assert.equal(officialOvenSampleAllowed({
    ...official,
    origin: "custom",
    repoKey: "aaaaaaaaaaaa",
  }, [official]), false);
});
