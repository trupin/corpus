# [AGENT-049] The orchestrate skill promises idle a shape the CLI prints only under --json

## Domain
agent-runtime

## Status
done

## Priority
P2 (nice-to-have)

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 7 — parking and the idle verb
- SHARED-070 audit report — `issues/evals/SHARED-070-token-audit.md`

## Summary

`assets/workspace/claude/skills/orchestrate/SKILL.md` states, in "The loop":
*"When its ~8-minute window expires with nothing pending it prints
`{"idle":true,"reason":"timeout"}`"* and *"prints `{"idle":true,"reason":"halted"}`"*
while halted. Measured against the shipping CLI (SHARED-070 audit, 2026-08-23):

- human mode prints `idle — no events (timeout)` and `idle — no events (halted)`
- only `--json` prints `{"idle":true,"reason":"timeout"}`

The skill's examples run `corpus queue idle` bare, so the loop it teaches will
never see the string the skill tells it to expect. An agent branching on the
promised shape misreads a normal timeout. (`claim-all` is different and fine:
it really does print one JSON payload in both modes, as its skill text says —
verified.)

## Acceptance Criteria
- [x] The skill's two idle-output claims match what the shipping CLI prints in
      the mode the skill's own examples use. Either quote the human strings, or
      have the examples pass `--json` — one of the two, consistently.
- [x] The arrival-notification return (`evt_… comment.created`) is described
      accurately too if the section is touched.
- [x] No CLI change — this is skill text. If the fix is judged to belong on the
      CLI side instead (print JSON in both modes like `claim-all`), escalate to
      the orchestrator rather than widening this issue.

## Technical Design

### Files to Create/Modify
- `assets/workspace/claude/skills/orchestrate/SKILL.md` — "The loop" and HALT
  sections

### Key Implementation Details
Measured outputs to quote: `idle — no events (timeout)`,
`idle — no events (halted)`, and on arrival `evt_rwjm6utsiqpc comment.created`
(one line per pending event).

### Edge Cases
- The converse skill may carry the same promise for its scoped idle — check and
  fix in the same pass if it does.

## Testing Strategy
None beyond re-reading — prose fix. The workspace-template drift test (AGENT-059's
class) covers verb existence, not output shapes.

## E2E Verification Plan
Run `corpus queue idle --wait 3` bare and with `--json` in a scratch workspace;
compare against the revised text.

### Verification Steps
1. Scratch workspace, server up, empty queue
2. `corpus queue idle --wait 3` → `idle — no events (timeout)`
3. `corpus queue idle --wait 3 --json` → `{"idle":true,"reason":"timeout"}`
4. Expected: the skill text quotes whichever the loop actually runs

## E2E Verification Log

_Implementing agent: agent-runtime-dev on **claude-fable-5**, 2026-08-23._

### The decision: the skill's promise was wrong, the CLI is right

The CLI's asymmetry is deliberate and internally consistent: `claim-all` prints one JSON
payload in both modes because the batch **is** the work order the loop parses, while `idle`'s
return is a signal — a timeout line, or one frugal line per pending event — and its human
register is the frugal one every other verb uses. The skill's examples run the bare command,
so the skill quotes what the bare command prints. Fixed as prose in both skills; no CLI
change, nothing escalated.

### Measured (CLI 0.20.0, scratch workspace, port 8931)

```
corpus queue idle --wait 2                → idle — no events (timeout)      exit 0
corpus queue idle --wait 2 --json         → {"idle":true,"reason":"timeout"} exit 0
(halted) corpus queue idle --wait 2       → idle — no events (halted)       exit 0
(pending) corpus queue idle --wait 2      → evt_6zhqn3atm5ri comment.created exit 0
corpus queue idle --thread <lane> --wait 2 → idle — no events (timeout)     exit 0  (scoped: same shapes)
```

### What changed

- `orchestrate/SKILL.md` — *The loop*'s outcome paragraph quotes
  `idle — no events (timeout)` / `idle — no events (halted)` and now also describes the
  arrival return accurately (one line per pending event, id then type, the notification step
  8 reads); *HALT* quotes the halted line. No `--json` alternative offered — the loop runs
  the bare command, one register, consistently.
- `converse/SKILL.md` — the edge case was real: the same two JSON promises appeared twice
  (the quiet-claims paragraph and the exit paragraph) and are now the human strings; the
  peer-listener paragraph's "names in its own `events`" became "names what is pending on
  your lane, one line per event", since the bare park prints lines, not an `events` key. The
  discriminator itself (park-named id held by somebody else at the claim) is untouched.

### Guard

The orchestrate non-negotiables pin now carries the two human strings with an AGENT-049
comment; the converse loop test asserts the human strings and `not.toContain('"idle":true')`.
486/486 template tests pass.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
