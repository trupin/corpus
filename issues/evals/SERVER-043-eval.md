# Evaluation: SERVER-043

**Date**: 2026-08-01
**Sprint**: sprint-021
**Evaluator model**: Opus 5 (1M context)
**Verdict**: PASS

Same rig as SERVER-042 (workspace `…/eval-p8/ws`, port 8808, scratch model cache).

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Five numbered legs plus a voided-criteria section |
| Commands are specific and concrete | PASS | Named pids (66883, 67463, 67757, 68802, 69003), exact log lines, exact config JSON |
| Real E2E (not mocked) | PASS | Real server on 8805, real fake HTTP endpoint on 8804, real `sqlite3` reads |
| Scenarios cover acceptance criteria | PASS | All four criteria have live evidence |
| Application restarted after changes | PASS | Five separate boots, each with its pid |
| Actual model recorded (implemented on:) | PASS | "implemented on: opus (Claude Opus 5)" |
| Reproduction logged before fix (bugs) | N/A | Feature issue |
| Deferrals recorded, not skipped | PASS | TEST-841/842/848 marked `VOID → OC1-REVISED` with substitute assertions named |

The voiding of TEST-841/842/848 is legitimate: OC1-REVISED (user ruling, 2026-07-31) removed the
runtime probe those tests protected, and the sprint contract's own rule is that a struck criterion is
recorded with its reason and substitute. Both were.

## Criteria Results

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| 1 | Zero-config resolution: config > embedded engine > disabled; unavailable engine falls through silently | PASS | Zero-config boot with a cold cache logged `semantic index disabled: the all-MiniLM-L6-v2 embedding model (22.6 MiB) has not been downloaded yet` at `info`, never `error`, and search kept working |
| 2 | Identity recorded on first index write; sticky across later runs | PASS | `identity` went `null` → `local/all-MiniLM-L6-v2@384` at the first embed and survived 6 server restarts, 3 `db rebuild`s and a config change unchanged |
| 3 | Config-declared provider with an unreachable endpoint → explicit error state, never a silent fallback | PASS | See below — the loudest evidence in this batch |
| 4 | No network on any leg but a configured provider; no key material ever logged | PASS | Zero outbound sockets across a full 581-chunk embed drain; the API key appears **0** times in the server log |

### Criterion 3 — configured-but-dead provider, measured

`.corpus/config.json` given
`{"provider":"ollama","endpoint":"http://127.0.0.1:8899","model":"nomic-embed-text","apiKey":"sk-eval-SECRET-abc123"}`
with nothing listening on 8899 (`lsof -nP -iTCP:8899 -sTCP:LISTEN` → `8899 free`), against a
**complete, valid** index of 561 chunks:

```
$ corpus index status
identity    local/all-MiniLM-L6-v2@384      ← preserved, not zeroed
indexed     561                             ← preserved
pending     0
failed      0
rebuilding  no
state       disabled

$ corpus db doctor
semantic_index_unusable (no file): the semantic index holds vectors from local/all-MiniLM-L6-v2@384
  and nothing can embed right now: ollama endpoint http://127.0.0.1:8899/api/embed is unreachable:
  fetch failed. The vectors are untouched and still valid — search is lexical until an embedding
  provider is available again (`corpus index status`)
projection is clean — 139 documents from 139 files (8ms)          exit=0

$ corpus search "physician prescribed antibiotics" --json
{"hits":[{"id":"doc_evalphys01",...}],"semanticIndex":"disabled"}     ← lexical only, one hit
```

Both halves hold: the failure is surfaced by name **and** nothing else resolved — the embedded engine
was not silently substituted (the paraphrase document, which the embedded engine finds, disappeared
from the hits). The warning names the exact endpoint, which is what an operator needs.

### Criterion 4 — no network, no keys

```
$ /usr/bin/grep -c "sk-eval-SECRET-abc123" .corpus/server.log
0
```

Zero, on the failing path — and the endpoint URL *is* logged, so the redaction is selective rather
than the log simply being empty.

Sockets held by the server process across six samples of a live 581-chunk embed drain:

```
node 81260 … 17u IPv4 … TCP 127.0.0.1:8808 (LISTEN)
   ESTABLISHED outbound: 0      (×6, at indexed=64,176,240,320,416,512)
```

One listening socket, zero outbound connections, for the whole drain.

### No probe, anywhere — OC1-REVISED's central claim

```
$ /usr/bin/grep -rniI -e "ollama" -e "11434" -e "daemon" -e "model server" …/eval-p8/ws --exclude-dir=.git
  → only 3 hits, all in .corpus/server.log, all the error line from the provider *I* configured

$ /usr/bin/grep -c 11434 dist-package/server/main.js            → 0
$ /usr/bin/grep -c "api/tags" dist-package/server/main.js        → 0
$ /usr/bin/grep -c "ollama serve" dist-package/server/main.js    → 0
$ /usr/bin/grep -o "ollama" dist-package/server/main.js | wc -l  → 4   (the configurable provider name only)
```

The shipped bundle contains no daemon port, no `/api/tags` probe, and no way to start one. The
installed workspace template mentions no model server at all.

## Failures

None.

## Summary

4 of 4 criteria pass. The one place the design chooses loud over graceful — a *configured* provider
failing — is genuinely loud, names the endpoint, preserves the counts and the identity so the state
is distinguishable from a fresh workspace, and does not leak the API key. The no-model-server posture
is real, not merely intended: zero occurrences of `11434` or `/api/tags` in the shipped bundle.
