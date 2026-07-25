# Loop provider setup

Use this before the first host-executed Loop when the user's available agent
subscriptions are unknown. Burnlist does not install, authenticate, configure,
or launch an agent provider.

## Inventory first

Check native subagents exposed by the current host, then perform only
non-mutating CLI discovery:

```sh
command -v codex && codex --version
command -v agy && agy models
command -v grok && grok models
```

If an installed provider skill supplies a safer auth preflight, prefer it.
Never read or print token files. A binary or cached auth record does not prove a
paid subscription; a successful live model listing proves only current access.

Present a compact inventory before assigning providers:

```text
Provider  Native/CLI  Login  Models or subscription  Intended Loop roles
Codex     CLI         ready  <observed>              maker, reviewer
AGY       CLI         setup  unknown                 optional reviewer
Grok      CLI         ready  <observed>              optional challenger
```

Ask the user whether they want to use the ready providers and whether they want
instructions for any missing login or installation. Do not start OAuth, install
a CLI, or alter provider configuration without that choice.

## Login handoff

- Codex: ask the user to run `codex login` if its own status or first invocation
  reports that authentication is missing.
- AGY: ask the user to run `agy` interactively and complete browser OAuth.
- Grok: ask the user to run `grok login`.

After the user completes setup, rerun the non-mutating live check. Provider
selection is working-session context, not Burnlist canonical state: never write
subscriptions, tokens, or provider profiles into `.burnlist/`.

## Choose per node

Use the Loop node's role, authority, and intelligence as selection guidance,
then choose among the providers the user made available. Record observed
provider/model/effort only in optional host telemetry. The `.loop` graph does
not pin a subscription or grant Burnlist authority to launch a provider.
