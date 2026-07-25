# Host-executed Loop nodes

Use this reference when a host executes a prepared agent node. It is the whole
provider-neutral contract; choose the matching `loop-providers/` recipe before
invocation. If subscriptions are unknown, read `loop-provider-setup.md` first.

## Next, execute, submit

1. Create the Run, then ask Burnlist for its next prepared host task:

   ```sh
   burnlist loop create item:<burnlist-id>#<item-id>
   burnlist loop next run:<id>
   ```

   `next` atomically claims the current agent node and returns one
   `burnlist-loop-host-task@1` packet. Give its `prompt` to the selected native
   agent or provider. The packet contains the role, read/write authority, legal
   outcomes, and prepared task context; it does not expose claim, invocation,
   assignment, dispatch-authority, or graph-edge mechanics.

2. Execute the supplied prompt against the assigned repository. The worker
   needs no Burnlist skill, CLI commands, claim identity, graph knowledge, or
   telemetry instructions. Respect the packet's authority and legal outcomes.
   Do not ask the worker to choose a graph edge or run the trusted check;
   Burnlist owns both.

3. Submit only the worker's semantic outcome by RunRef. Burnlist binds it to
   the sealed claim, validates the node mode, selects the declared graph edge,
   advances deterministic checks and gates, and stops at the next host task or
   terminal state:

   ```sh
   burnlist loop submit run:<id> --outcome complete
   burnlist loop submit run:<id> --outcome approve
   ```

   Use `complete` only after successful task execution and `approve` only after
   an independent read-only review. Stale claims, illegal outcomes, candidate
   drift, and conflicting submissions fail closed.

4. Rejection, escalation, findings, or optional truthful host telemetry use one
   small canonical `burnlist-loop-host-result@1` file. It contains no authority
   identities:

   ```json
   {"schema":"burnlist-loop-host-result@1","outcome":"reject","findings":[],"resolvedFindingIds":[],"telemetry":null}
   ```

   ```sh
   burnlist loop submit run:<id> --result ./host-result.json
   ```

   The file must be a regular non-symlink no larger than 256 KiB. For a
   rejection or escalation, carry forward every still-open finding, add only
   content-addressed findings, and resolve only open ids. Unknown telemetry
   fields remain `null`; never guess them.

5. Repeat `next` and `submit` until the Run is terminal, then use
   `burnlist loop complete run:<id>` to atomically apply a converged Run.

If one provider is unavailable before it mutates the workspace, keep the
   provider-neutral claim and retry through another ready provider after the
   first process has definitely exited. Do not abandon merely because a quota
   was exhausted. If the host cannot finish or process cleanup is uncertain,
   do not submit a made-up result. Use the recovery commands below.

## Recovery and diagnostics

`claim` and `report` preserve the lower-level authority-envelope protocol for
diagnostics and recovery. They are not needed for ordinary execution:

```sh
burnlist loop claim run:<id>
burnlist loop report cl1-sha256:<claim-id> --outcome complete
burnlist loop report cl1-sha256:<claim-id> --result ./host-report.json
```

Treat the returned claim and execution envelope as opaque, bounded, single-use
authority. Never reconstruct its identity tuple or add a graph destination.
If a live host must be resolved, abandon its ClaimRef once:

```sh
burnlist loop abandon cl1-sha256:<claim-id> --reason host-cancelled
```

The only reasons are `host-cancelled`, `host-lost`, and (after expiry)
`expired`. Recovery can terminalize as `needs-human`; it does not make the host
the transition authority.

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
