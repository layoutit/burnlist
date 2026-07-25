# Host-executed Loop nodes

Use this reference when a host executes a prepared agent node. It is the whole
provider-neutral contract; choose the matching `loop-providers/` recipe before
invocation. If subscriptions are unknown, read `loop-provider-setup.md` first.

## Claim, execute, report

1. Create and inspect the Run, then claim its current agent node:

   ```sh
   burnlist loop create item:<burnlist-id>#<item-id>
   burnlist loop claim run:<id> > .local/burnlist/claim.json
   node -e 'const c=require(process.argv[1]); console.log(c.claim.claimId)' \
     .local/burnlist/claim.json
   ```

   `claim` returns canonical JSON containing a `claim` and an `execution`
   envelope. Treat both as opaque, bounded, single-use authority. Do not alter
   or reconstruct their fields. Capture it to a private ignored file as above
   instead of printing the large authority envelope into chat. The second
   command prints the `ClaimRef`; it does not replace the saved execution
   envelope needed by the provider.

2. Decode, inspect, and execute the exact prepared invocation. `execution` is
   a canonical `burnlist-loop-host-execution@1` object: base64-decode its
   `invocationInput` to the canonical `burnlist-loop-invocation-input@1` JSON.
   That object contains base64 `instructionBytes`, `itemText`, and
   `candidateContext`; decode them as UTF-8 only for the executor. It also
   declares the node `mode`, `role`, `authority`, legal outcomes, and required
   evidence ids. Keep `execution`, its
   `dispatchAuthority`, and every identity field byte-for-byte unchanged. Do
   not edit, reserialize, or replace those authority-bearing inputs.

   The host may choose its provider, subagent arrangement, and additional
   non-authoritative context, but must preserve the complete correlation tuple:

   ```text
   runId + nodeId + attempt + claimId + invocationId + assignmentId
   + recipeRevision + policyRevision + inputCandidate
   ```

   Execute the supplied instructions against the exact assigned item and
   candidate context. Respect read/write authority and legal outcomes. Do not choose
   a graph edge, declare a destination, or run a deterministic check; Burnlist
   owns all three.

3. For the common successful path, inspect the provider result and report the
   legal outcome directly. Burnlist copies the sealed identity tuple from the
   live claim, so the host does not hand-author authority-bearing JSON:

   ```sh
   burnlist loop report cl1-sha256:<claim-id> --outcome complete
   burnlist loop report cl1-sha256:<claim-id> --outcome approve
   ```

   Use `complete` only after successful task execution and `approve` only after
   an independent read-only review. The command still fails closed on a stale
   claim, wrong node mode, or candidate drift.

4. Findings, rejection, escalation, or telemetry require one canonical
   `burnlist-loop-host-report@1` whose `agent-result@1`
   is bound to that same tuple, with only a legal node-mode outcome. Copy the
   identity values exactly from `execution`; do not use these placeholders as
   invented values. A task accepts `complete`; review accepts `approve`,
   `reject`, or `escalate`. A task has empty `findings` and
   `resolvedFindingIds`.

   Task report with unavailable telemetry:

   ```json
   {"schema":"burnlist-loop-host-report@1","result":{"schema":"agent-result@1","runId":"<execution.runId>","nodeId":"<execution.nodeId>","attempt":<execution.attempt>,"claimId":"<execution.claimId>","assignmentId":"<execution.assignmentId>","invocationId":"<execution.invocationId>","recipeRevision":"<execution.recipeRevision>","policyRevision":"<execution.policyRevision>","inputCandidate":"<execution.inputCandidate>","outcome":"complete","findings":[],"resolvedFindingIds":[]},"telemetry":null}
   ```

   Reviewer report with the full optional telemetry shape (replace only values
   the host observed; the sample timing and token fields are intentionally
   unavailable):

   ```json
   {"schema":"burnlist-loop-host-report@1","result":{"schema":"agent-result@1","runId":"<execution.runId>","nodeId":"<execution.nodeId>","attempt":<execution.attempt>,"claimId":"<execution.claimId>","assignmentId":"<execution.assignmentId>","invocationId":"<execution.invocationId>","recipeRevision":"<execution.recipeRevision>","policyRevision":"<execution.policyRevision>","inputCandidate":"<execution.inputCandidate>","outcome":"approve","findings":[],"resolvedFindingIds":[]},"telemetry":{"schema":"burnlist-loop-host-telemetry@1","provenance":"host-reported","executor":"provider-executor","displayName":null,"provider":null,"model":null,"effort":null,"startedAt":null,"completedAt":null,"inputTokens":null,"outputTokens":null}}
   ```

   For a `reject` or `escalate`, carry forward every still-open finding, add
   any new content-addressed finding, and resolve only currently open ids.
   Optional telemetry always uses `burnlist-loop-host-telemetry@1` with
   `provenance: "host-reported"`; unknown values remain `null`, never guessed.

5. Write that detailed report to a regular, non-symlink file no larger than 256 KiB and
   submit it by the claim id:

   ```sh
   burnlist loop report cl1-sha256:<claim-id> --result ./host-report.json
   ```

   An identical retransmission is safe. A conflicting replay, expired or stale
   claim, workspace/candidate drift, illegal outcome, or identity mismatch fails
   closed. Inspect the Run again rather than editing a rejected report.

6. If one provider is unavailable before it mutates the workspace, keep the
   provider-neutral claim and retry through another ready provider after the
   first process has definitely exited. Do not abandon merely because a quota
   was exhausted. If the host cannot finish or process cleanup is uncertain,
   do not report a made-up result. Resolve its live
   claim once:

   ```sh
   burnlist loop abandon cl1-sha256:<claim-id> --reason host-cancelled
   ```

   The only reasons are `host-cancelled`, `host-lost`, and (after expiry)
   `expired`. Recovery can terminalize as `needs-human`; it does not make the
   host the transition authority.

## Ownership and observability

The host owns every provider invocation and optional best-effort telemetry.
Burnlist owns the frozen graph, claim authority, validation, deterministic
checks, transition selection, canonical journal, and item completion. After
`loop report`, Burnlist automatically advances trusted checks and graph-only
nodes until the next host agent claim or a terminal state. It never launches a
provider process.

Installable skills and Streaming Diff hooks are independent. Neither installs,
selects, or starts a host executor; hooks only provide optional observational
activity.
