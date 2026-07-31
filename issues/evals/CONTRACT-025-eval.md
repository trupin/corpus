# Evaluation: CONTRACT-025

**Date**: 2026-07-31
**Sprint**: sprint-018
**Evaluator model**: Opus 5 (`claude-opus-5[1m]`)
**Verdict**: PASS

Brief by design: this rider's behaviour is only observable through its consumer, and
that consumer is SERVER-038. The wire evidence below was collected in the same
session — see `issues/evals/SERVER-038-eval.md` for the full doctor drill.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                        |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| Verification log present                | PASS   | Branch and model named.                                                       |
| Commands are specific and concrete      | PASS   | Regeneration and drift-check evidence.                                        |
| Real E2E (not mocked)                   | PASS   | Consumed live by SERVER-038 over real HTTP in this evaluation.                 |
| Scenarios cover acceptance criteria     | PASS   | Optional field, open kind space, regeneration + drift.                        |
| Application restarted after changes     | PASS   | The server I probed was built from this branch and answers the new shape.      |
| Actual model recorded (implemented on:) | PASS   | "**Model: opus** (`claude-opus-5[1m]`), matching the issue's recommendation."  |
| Reproduction logged before fix (bugs)   | N/A    | Contract rider.                                                               |

## Criteria Results

| #   | Criterion                                                                          | Result | Notes                                                       |
| --- | ------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------- |
| 1   | Doctor response gains optional `warnings`; failure/exit semantics untouched          | PASS   | Not in `required`; `ok`/exit unchanged on a warned workspace. |
| 2   | Kind space extensible without a contract edit per kind                               | PASS   | Pattern-constrained string, not a closed literal union.      |
| 3   | `openapi.json` + client regenerated, drift check green                               | PASS   | `check-generated-artifacts.ts` clean.                        |
| 4   | Warnings carry `kind`/`path`/`detail`/`commit` on the wire                           | PASS   | Verified live, below.                                        |

## Evidence

### The schema

```
DoctorReport  required: ['ok', 'drift', 'stats']        ← warnings is optional
DoctorWarning required: ['kind', 'path', 'detail', 'commit']

kind:   type string, pattern "^[a-z][a-z0-9_]*$", maxLength 64
        "Open by design, unlike ProjectionDrift.kind: a warning carries no verdict, so a
         consumer that does not recognise the kind still renders `detail` and loses nothing,
         and the server can add a finding without a contract release."
path:   type ["string","null"]
commit: type ["string","null"], pattern "^[0-9a-f]{7,64}$"
ok:     "…`warnings` never moves it."
```

A pattern rather than an enum is what makes criterion 2 true: SERVER-038 shipped a
second kind (`unindexable_files_truncated`) with no contract edit.

`path` and `commit` are **required-and-nullable** rather than optional, so a consumer
never has to distinguish "absent" from "none".

### The shape on the wire, live

`GET /api/db/doctor` against the running server, on a workspace carrying seeded
invisible documents:

```json
{
  "ok": true,
  "drift": [],
  "warnings": [
    {
      "kind": "unindexable_file",
      "path": "data/docs/.claude/skills/invisible-doc.md",
      "detail": "… Added in c737c70 \"seed invisible documents and near-miss fixtures (pre-SERVER-037)\". Move it elsewhere under data/docs/ or delete it — doctor changes nothing.",
      "commit": "c737c70"
    },
    { "kind": "unindexable_file", "path": "data/docs/node_modules/ignored-dir-doc.md",  "commit": "c737c70", "detail": "…" },
    { "kind": "unindexable_file", "path": "data/docs/notes/.hidden/x/nested-hidden.md", "commit": "c737c70", "detail": "…" }
  ],
  "stats": { "files": 24, "documents": 24, "hashed": 0, "parsed": 0, "durationMs": 17 }
}
```

All four fields present on every entry, with a real sha in `commit`.

`corpus db doctor --json` on a **healthy** workspace emits `warnings: []` — present
and empty rather than absent, so the CLI never has to branch on undefined — and
`ok: true` / exit 0 on both the healthy and the warned workspace. Warnings moved
neither.

### Regeneration and drift

```
$ npx tsx scripts/check-generated-artifacts.ts
✓ API contract is up to date (packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts).
✓ CLI reference is up to date (docs/cli.md).
```

## Failures

None.

## Summary

4 of 4 criteria passed. The optional `warnings` rider is on the wire with all four
fields, the kind space is genuinely open (a second kind shipped in the same phase
with no contract edit), `ok` and the exit code are untouched in both directions, and
the generated artifacts are drift-free.
