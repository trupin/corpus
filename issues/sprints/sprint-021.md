# Sprint 021 — Retrieval B: the semantic index, and the two numbers that decide its shape

**Issues**: SERVER-042 · SERVER-043 · SERVER-044 · CONTRACT-023 · SERVER-045 · SERVER-046 · CLI-020 · INFRA-012
**Domains**: server, contract, cli, infra
**Branch**: `phase-8-retrieval-b` (orchestrator-owned)
**Date**: 2026-07-31
**Test numbering**: continues the ladder from sprint-020's `TEST-822`; this sprint runs
`TEST-823`–`TEST-941`.

---

## What this wave is

Five server issues in a **hard chain** (042 → 043 → 044 → {045, 046}), one contract issue that can
start immediately, one CLI issue that is smaller than it reads, and one infra issue whose entire
premise depends on a decision the user has not made yet.

This batch has the most unverified technical premises of any sprint so far, and the pre-flight
found that **the two premises carrying the most weight are both wrong in the same direction — the
issues assume expensive machinery where measurement says cheap machinery is ample**:

1. **The native vector extension is unnecessary.** SERVER-045 calls a sqlite vector extension "the
   preferred shape" and a pure-JS brute-force scan "an acceptable v1 fallback". Measured on this
   machine: a brute-force cosine scan over **10,000 chunks × 384 dims is 3.27 ms per query**, and
   reading all 10,000 vectors back out of SQLite as BLOBs is **10.8 ms**. The "fallback" is the
   answer. See C7.
2. **The bundled model is a ~90× install-footprint increase.** The packed product is **2.94 MiB**
   today. A bundled int8 MiniLM adds **21.9 MiB** to the tarball — and the ONNX runtime needed to
   execute it adds **258 MiB** of `node_modules` plus a native `postinstall`. That is Open Conflict
   1, and it is a user decision about what Corpus *is*, not an implementation choice. See C10.

Beyond those two, the contract's frozen vocabulary has already decided something three issue files
get wrong: **`catching-up` and `lexical-only` do not exist.** The shipped, signed enum is
`current` / `indexing` / `stale` / `disabled` (C3). Nothing in this sprint may widen it.

**The bar for this wave is "Phase A did not move".** Phase A's ranked search and related lists are
signed, shipped, and covered. Phase B adds a second relevance signal *to the same lists*. Every
issue below is therefore contracted twice: once for what it adds, and once for what it must leave
byte-identical in a workspace with no semantic index.

---

## Premise corrections — what the pre-flight found

Verified against the tree at contract time (2026-07-31), read-only: no installs into the repo, no
builds, no tests, no git. npm metadata probed from an isolated scratch package; model artifact sizes
from HTTP `HEAD`; benchmarks run as standalone `node -e` scripts against `node_modules` that already
existed. **Sixteen premises are wrong, incomplete, or unmeasured.**

### C1 — SERVER-042: there is no migration pattern. The pattern is wipe-and-rebuild

SERVER-042's acceptance criterion reads "SCHEMA_VERSION bumped with migration + downgrade refusal
per existing pattern". There is no migration code in this repository and there is not meant to be.
`apps/server/src/projection/db.ts:146-150`, verbatim:

> A database stamped with a different `SCHEMA_VERSION` is **wiped and rebuilt, never migrated**: the
> projection is derived, so schema evolution costs a rebuild rather than migration code. That rule
> is what enforces the invariant behind it — nothing durable may ever live only in SQLite.

`schema.ts:9-39` says the same: "a database stamped with a different value is dropped and rebuilt
from files, so there is deliberately no migration path."

Current value: **`SCHEMA_VERSION = 8`** (`schema.ts:40`). The correct work is: bump to **9**, extend
`PROJECTION_DDL`, and add the new tables to `PROJECTION_TABLES` (`schema.ts:47-60`) and — for the
derived ones only — `REPOPULATED_TABLES` (`schema.ts:69-81`, children-first order).

The "downgrade refusal" half is real but lives somewhere else and behaves differently in the two
open paths, and the difference is operationally load-bearing:

| Path | Function | Behaviour on stamp mismatch |
| --- | --- | --- |
| Server boot (read-write) | `openProjectionDatabase` (`db.ts:151-172`) | logs, closes, **deletes the file**, recreates empty; boot catch-up repopulates |
| `corpus db doctor` (read-only) | `openProjectionReadonly` (`db.ts:279-305`) | **throws `ProjectionError`** naming `corpus db rebuild` |

**Consequence for this sprint, binding on every agent**: the moment SERVER-042 commits, any
pre-existing workspace's `corpus db doctor` errors until a rebuild runs. That is designed behaviour,
not a regression — but every E2E procedure in this batch starts with `corpus db rebuild`.

### C2 — SERVER-042: "only the edited section's chunk rows change" is not achievable as written

`projectDocument` deletes a document's per-document rows and reinserts them wholesale
(`project-document.ts:226-236`):

```
"DELETE FROM threads WHERE id = ?",
"DELETE FROM turns WHERE thread_id = ?",
"DELETE FROM anchors WHERE doc_id = ?",
"DELETE FROM links WHERE from_id = ?",
"DELETE FROM search WHERE doc_id = ?",
```

If chunks follow that pattern, **every chunk row of the document is rewritten on every save**, and
anything stored on the chunk row — an embedding — is destroyed by an unrelated typo three sections
away. A row-level diff test would fail on a correct implementation and pass on a useless one.

The shape that makes the criterion both true and measurable is **two tables**:

- `chunks(doc_id, chunk_id, heading_path, ord, start_offset, end_offset, content_hash, …)` —
  delete-and-reinsert per document exactly like `search`, in `REPOPULATED_TABLES`. Cheap, and its
  churn is not what anybody cares about.
- `chunk_embeddings(chunk_id PRIMARY KEY, identity, dim, vec BLOB, state, failures, updated_ms)` —
  keyed by the **content-addressed** chunk id, **never touched by the document projector**, garbage-
  collected separately. This is the table the observable criterion is about.

The criterion is then honest and countable: *after a one-section edit, the number of
`chunk_embeddings` rows that get recomputed equals the number of chunks whose content changed* —
which for a heading-path-and-content hash is exactly the edited sections. See Open Conflict 5 for
what happens to `chunk_embeddings` across `db rebuild`.

### C3 — CONTRACT-023 / SERVER-045 / CLI-020: `catching-up` and `lexical-only` do not exist

All three issue files name the Phase B states `current` / `catching-up` / `lexical-only`. The
enum shipped with CONTRACT-022 and signed under SHARED-006 is
(`packages/contract/src/schemas/retrieval.ts:83`):

```ts
export const SEMANTIC_INDEX_STATES = ["current", "indexing", "stale", "disabled"] as const;
```

The same file, `:23-32`, records why widening it later is forbidden:

> Phase B adds semantic relevance to the *same* ranked lists, *in place*, without moving a field.
> […] Widening either later would be precisely the migration the freeze was signed to avoid.

And the published description already assigns each value a meaning (`retrieval.ts:90-99`):
`indexing` — "a rebuild or backfill is running"; `stale` — "documents are still pending";
`disabled` — "no semantic index is configured — lexical ranking only".

**The mapping this sprint implements** (and CONTRACT-023 does *not* get to add a value):

| Issue-file word | Wire value | Condition |
| --- | --- | --- |
| — | `current` | a usable index exists, `pending == 0`, no rebuild in flight |
| `catching-up` | `indexing` | a full rebuild is in flight (`index rebuild`, identity invalidation) |
| `catching-up` | `stale` | incremental backlog only: `pending > 0`, no rebuild in flight |
| `lexical-only` | `disabled` | no resolved provider, no recorded identity, or no usable vectors |
| (Phase A) | *absent* | the server makes no claim — today's behaviour |

`indexing` outranks `stale` when both apply. Ruling requested as Open Conflict 4.

### C4 — Phase A deliberately emits **no** `semanticIndex` field, and a test pins its absence

`apps/server/src/search/search.ts:199-204` returns `{ hits }` with a comment stating that emitting
`current` "would be the first line of Phase B machinery written under a Phase A issue".
`search.test.ts:446-447` asserts `expect("semanticIndex" in results).toBe(false)`.
`docs/related.ts:96-99` and `related.test.ts:245` do the same for related.

So Phase B does not "populate an existing field" — it **starts emitting a field that is currently
provably absent**, and it must update those two pinning tests as a deliberate, called-out act. A
diff that quietly deletes an `in`-check is the failure mode.

### C5 — SERVER-042's PR #15 note cannot be closed without chunk-granular matching

The bug is real and reproduced by reading: `locatePassage` (`search/heading-path.ts:105-125`) locates
the snippet window with `text.indexOf(window)` — the **first** occurrence. A document with identical
boilerplate under two headings is always addressed by the earlier section.

But the fix the AC demands — "chunk addressing must key on the actual matched chunk, making this
class impossible" — requires knowing **which chunk FTS5 matched**, and FTS5 today indexes whole
documents and whole turns, one row per document/turn (`schema.ts:242-249`, `ref` UNINDEXED). No
offset arithmetic over a doc-granular match can recover a chunk identity when the text is identical.

This collides head-on with this sprint's byte-stability requirement: making `search` chunk-granular
changes bm25 (different row lengths ⇒ different scores) and therefore changes Phase A's ranking.
**Open Conflict 3** carries the three options and a recommendation.

### C6 — the search ranking is one SQL statement, and `LIMIT` is applied inside it

`searchCorpus(db, query, nowMs, loadTexts)` (`search/search.ts:162-167`) is the single entry point;
`routes.ts:26-28` calls nothing else. The ranking is one prepared statement (`search.ts:50-65`,
executed at `:177`) and everything after it is pure assembly. Two facts a fusion implementation must
respect:

- **Ranking is raw FTS5 `rank`** — plain bm25, **no column weights**. `docs/filters.ts:132-137`:
  "`rank` is FTS5's bm25 score (more negative is a better match), and it is the *only* ranking in
  the product." A grep for a `bm25(...)` SQL call returns nothing.
- **`LIMIT @limit` is in the SQL** (`search.ts:65`, bound `:175`). Reciprocal-rank fusion needs the
  lexical list **over-fetched** past `limit` or the fusion sees a truncated tail. Changing that
  binding is a required, named change.

Determinism is already implemented at two levels and must survive fusion:
`RELEVANCE_ORDER_BY = "m.rank ASC, d.id ASC"` (`filters.ts:153`) and `MIN(h.ref)` for which passage
represents a document (`search.ts:53`).

### C7 — SERVER-045: the pure-JS scan is not a fallback, it is the answer (measured)

Benchmarked on this machine, `node -e`, flat `Float32Array`, pre-normalised vectors (cosine == dot),
10 iterations averaged after warmup:

| chunks × dims | vector bytes | brute-force scan |
| --- | --- | --- |
| 1,000 × 384 | 1.46 MiB | **1.19 ms/query** |
| 10,000 × 384 | 14.65 MiB | **3.27 ms/query** |
| 50,000 × 384 | 73.24 MiB | **16.62 ms/query** |
| 10,000 × 768 | 29.30 MiB | **6.72 ms/query** |
| 100,000 × 768 | 292.97 MiB | **68.13 ms/query** |

And the storage round-trip, better-sqlite3 12.11.1 against a real WAL database:

- insert 10,000 × 384 BLOBs in one transaction: **93 ms**; resulting db file **19.58 MiB**
- `SELECT id, vec FROM v` reading all 10,000 rows: **10.8 ms per full scan**

So a cold, cache-free semantic query at 10k chunks is **~14 ms end to end**; with a warm
`Float32Array` held in memory it is **3.3 ms**. The issue's target corpus is 1–10k chunks. A native
KNN index earns its keep somewhere past 10⁵ vectors, which this product does not reach.

For reference, sqlite-vec *is* viable — it is just unnecessary:

| Package | `dist.unpackedSize` |
| --- | --- |
| `sqlite-vec@0.1.9` (JS loader) | 4,004 B |
| `sqlite-vec-darwin-arm64@0.1.9` | 162,252 B |
| `sqlite-vec-darwin-x64@0.1.9` | 127,984 B |
| `sqlite-vec-linux-x64@0.1.9` | 160,160 B |
| `sqlite-vec-linux-arm64@0.1.9` | 156,868 B |
| `sqlite-vec-windows-x64@0.1.9` | 289,628 B |
| **all five staged** | **896,892 B (876 KiB)** |

It is pre-1.0 (`0.1.9`, with a `0.1.10-alpha.4` alpha tag) and distributes per-platform binaries as
exact-pinned `optionalDependencies`.

### C8 — better-sqlite3 *can* load extensions; that premise is the one that held

`apps/server/package.json:16` declares `better-sqlite3: ^12.4.1`; the installed tree is **12.11.1**.
`loadExtension` exists (`node_modules/better-sqlite3/lib/database.js:83`, typed at
`@types/better-sqlite3/index.d.ts:84` as `loadExtension(path: string): this`).

Probed decisively — calling it on a nonexistent path produced a **`dlopen` failure**, not an
authorization refusal, which means extension loading is compiled in:

```
ERR: dlopen(/nonexistent/definitely_not_here.dylib, 0x000A): tried: … (no such file)
```

`PRAGMA compile_options` on the bundled SQLite shows `ENABLE_FTS5`, `ENABLE_MATH_FUNCTIONS`, and
**no `OMIT_LOAD_EXTENSION`**. Note also that better-sqlite3 appends the platform suffix itself
(`.dylib` was added to the path given). So the seam is available if it is ever wanted — see Open
Conflict 2 for why this sprint should not want it.

### C9 — SERVER-043: "local runtime reachable" is not the right probe

Ollama's default port is `11434`. Reachability is necessary and **not sufficient**: a reachable
Ollama with only chat models pulled answers `/api/embed` with a 404 (`model "…" not found, try
pulling it first`). This dev machine is the case in point — `ollama` **is** installed
(`/usr/local/bin/ollama`, client 0.32.1), not running, and `~/.ollama/models/manifests/…/library/`
contains `gemma3`, `gemma4`, `phi4`, `phi4-mini`, `qwen2.5`, `qwen3` and **no embedding model**.

The probe must therefore be two-step: `GET /api/tags` for reachability *and* model inventory, then
require either a configured model name or a documented default that is actually present. Since
SERVER-043 says "probe, never install", a runtime with no embedding model **falls through silently
to the next provider**, exactly like an unreachable one.

Endpoint shapes the implementing agent must verify against a live instance before relying on them
(recorded here as the expected shapes, not as verified facts — no Ollama was started):
`POST /api/embed` `{model, input: string|string[]}` → `{model, embeddings: number[][]}`; legacy
`POST /api/embeddings` `{model, prompt}` → `{embedding: number[]}`. Common embedding models and
their dimensions: `nomic-embed-text` (768), `mxbai-embed-large` (1024), `all-minilm` (384),
`bge-m3` (1024). The dimension is part of the identity string, so it is read from the response, not
assumed.

### C10 — INFRA-012: the real numbers, and they are the headline

**Baseline, measured**: `dist-package/` is **3,084,162 bytes (2.94 MiB) across 30 files**.

| `dist-package/` subtree | KiB |
| --- | --- |
| `ui/` | 1,344 |
| `plugins/` | 744 |
| `server/` | 492 |
| `dist/` (CLI bundle) | 392 |
| `assets/` (workspace template) | 84 |

**Model artifacts** (HTTP `HEAD`, `x-linked-size`):

| Artifact | Bytes | MiB | dims |
| --- | --- | --- | --- |
| `Xenova/all-MiniLM-L6-v2` `onnx/model.onnx` (fp32) | 90,387,606 | **86.2** | 384 |
| `Xenova/all-MiniLM-L6-v2` `onnx/model_quantized.onnx` (int8) | 22,972,370 | **21.9** | 384 |
| `Xenova/bge-small-en-v1.5` int8 | 34,014,426 | 32.4 | 384 |
| `Xenova/gte-small` int8 | 34,014,426 | 32.4 | 384 |
| tokenizer + config sidecars | ~700,000 | ~0.7 | — |

**Runtimes** (npm `dist.unpackedSize` — the number that lands in `node_modules`):

| Package | Bytes | MiB | Notes |
| --- | --- | --- | --- |
| `onnxruntime-node@1.27.0` | 270,827,297 | **258.3** | 43 files; `os: [win32, darwin, linux]` in **one** tarball; `postinstall: node ./script/install` |
| `onnxruntime-node@1.24.3` | 220,344,078 | 210.1 | the version `@huggingface/transformers@4.2.0` pins |
| `@huggingface/transformers@4.2.0` | 9,536,375 | 9.1 | 1,339 files; + `onnxruntime-node@1.24.3` + `onnxruntime-web` + **`sharp`** |
| `@xenova/transformers@2.17.2` | 46,618,273 | 44.5 | superseded by the above; still on `onnxruntime-web@1.14.0` |
| `sharp@0.34.5` | 533,628 | 0.5 | + **24** platform `optionalDependencies` (libvips) |
| `fastembed@2.1.0` | 109,291 | 0.1 | + `onnxruntime-node@1.21.0`; downloads models at runtime |

**The arithmetic the user has to rule on:**

| Posture | tarball | `node_modules` added | total footprint | vs today |
| --- | --- | --- | --- | --- |
| today | 2.94 MiB | 0 | 2.94 MiB | 1× |
| bundle int8 MiniLM + ONNX runtime | **~25.6 MiB** (8.7×) | **~268 MiB** | **~294 MiB** | **~100×** |
| bundle fp32 MiniLM + ONNX runtime | ~89.9 MiB | ~268 MiB | ~358 MiB | ~122× |
| download model on first index | 2.94 MiB | ~268 MiB | ~271 MiB | ~92× |
| **Ollama-or-configured only, no bundled model** | **2.94 MiB** | **0** | **2.94 MiB** | **1×** |

**The model is not the cost driver — the runtime is.** Deferring the model download leaves 92× of
the increase in place. This is Open Conflict 1.

It also runs straight into an existing, signed packaging value judgement: `pack-audit.ts:108-111`
forbids source maps outright because "source maps would multiply the install size for no operator
benefit". Source maps are a rounding error next to 258 MiB.

Two mechanical constraints on any bundled artifact: `FORBIDDEN_PACK_PATTERNS` bans `**/node_modules/**`
(`pack-audit.ts:91-94`), so a model can only arrive as a **staged tree** like `assets/`, never by
reaching into a dependency; and `REQUIRED_PACK_ENTRIES` (`pack-audit.ts:40-74`) is a positive
allowlist, so anything staged must gain a named required entry with a `reason` or the audit will not
notice it went missing.

### C11 — SERVER-044: the lifecycle hole is exactly shaped, and the ordering rule is load-bearing

`runServerProcess` (`lifecycle.ts:130-188`) attaches subsystems through injectable functions:
`attachProjectionFn` at `:159`, `attachWatcherFn` at `:162`, then `server.start()` at `:173`. An
`attachEmbeddingWorkerFn?: (server: CorpusServer) => void` inserted **after** `attachWatcher` at
`:162` is the hole.

`CorpusServer.close()` (`app.ts:490-520`) disposes in **reverse registration order**
(`for (const dispose of [...disposers].reverse())`), each in its own try/catch. A worker holding the
db handle must therefore register **after** `attachProjection`, or it will still be draining when
`db.close()` fires. Signals: `SHUTDOWN_SIGNALS = ["SIGINT","SIGTERM"]` (`lifecycle.ts:18`),
`SHUTDOWN_GRACE_MS = 5000` (`:21`), forced-exit backstop `unref`'d at `:212-219`.

The pattern to copy is the watcher (`watcher/watcher.ts:169`, attached at `watcher/attach.ts:21-54`):
timer always `unref`'d (`watcher.ts:456`), a **cancellation token read across every `await`**
(`cancelled: () => stopped`, `attach.ts:45`, rationale at `catch-up.ts:81-86` — "touching a closed
database would turn a clean shutdown into a crash"), and a **budget-and-defer batch loop** with a
first-entry livelock guard (`watcher.ts:402-448`). For the interval half, copy the SSE heartbeat's
convention: `heartbeatMs: 0` disables it entirely (`events/sse.ts:126`), which is how tests make it
inert. Tests drive the watcher by calling `handle.flush()` directly rather than faking timers
(`watcher.test.ts`), and that is the convention the worker's tests follow.

Recommended handle shape, so every test in this contract has something to call:
`startEmbeddingWorker({...}) → { tick(): Promise<void>; counts(): {indexed, pending, failed}; close(): Promise<void> }`,
with `intervalMs: 0` meaning "never self-schedule".

### C12 — SERVER-044: there is exactly one server write choke point, and it is not where you'd guess

Every server-originated mutation — `PUT /api/docs/{id}`, thread create/append, capture, skills,
plugin routes — funnels through `runMutation` in `docs/write.ts`. The projection step is
`write.ts:755-761`:

```ts
for (const path of plan.unproject) removeDocument(workspace.projection, abs(workspace, path));
for (const path of plan.project) {
  if (classifyPath(path) === null) continue;
  projectDocument(workspace.projection, abs(workspace, path));
}
```

Sequence: write files → `git.commit` (`:736-746`) → re-project (`:755-761`) → `bus.invalidate`
(`:765`). A "mark pending" hook belongs immediately after that loop and **before** `:763`, inside
the same request.

The other three pending sources:

- **watcher out-of-band**: `collectDocument` (`watcher/watcher.ts:239-305`) — `projectDocument` at
  `:285`; cheaper hook point is after the batch loop in `flush` (`watcher.ts:428-433`).
- **`db rebuild`**: `populateFromFiles` (`populate.ts:48`), `projectDocument` per file at `:62`.
- **identity invalidation** (SERVER-043): a boot-time check, no existing hook.

Transactions: `db.transaction<A, R>(fn)` (`db.ts:53-54`), savepoint-nesting via better-sqlite3.
Pragmas at open: WAL, `synchronous = NORMAL`, `foreign_keys = ON`, `busy_timeout = 5000`
(`db.ts:99-104`).

### C13 — SERVER-044/046: `db rebuild` swaps the file by rename, and that is a live hazard for a worker

`rebuild.ts:61-94` builds into `.corpus/cache.db.rebuild-<pid>`, closes it so the WAL is folded in,
then `renameSync(target, destination)` — **the rename is the commit point** (`rebuild.ts:1-6`).

The in-process answer is `ProjectionDb.reopenAround(replaceFile)` (`db.ts:55-76`, impl `:219-226`),
which the route wraps the rebuild in (`projection/routes.ts:120-122`) and then re-binds the queue
mirror (`:128`). The crucial property: **the `ProjectionDb` object identity never changes** — only
the connection beneath it moves, and the statement cache is cleared (`db.ts:198`).

So: a worker that captured the **`ProjectionDb`** survives a rebuild for free. A worker that
captured `db.sqlite`, or that holds a prepared `Statement` **across an `await`**, does not. That is
a testable constraint, not advice. Note also that everything from `reopenAround` through
`attachMirror` is **synchronous** (`routes.ts:113-119`).

### C14 — SERVER-046: doctor's shape, and where a semantic check plugs in

`DoctorReport` (`projection/doctor.ts:42-62`) is `{ ok, drift, warnings?, stats }` with
`ok === (drift.length === 0)` (`:212`). Six drift kinds exist (`DRIFT_KINDS`, `doctor.ts:18-33`):
`missing_row`, `orphan_row`, `content_mismatch`, `count_mismatch`, `unparseable`, `duplicate_id`.
The wire copy is re-declared in `packages/contract/src/schemas/db.ts:94-101`, so **a new drift kind
is a contract change** — and CONTRACT-023's scope does not mention one.

The SERVER-038 warnings surface exists and is deliberately asymmetric: `inspectProjection`
(`doctor.ts:205`, the boot catch-up's caller) returns **no `warnings` key at all**; `doctor(config)`
(`doctor.ts:237`) always returns an array, via `collectUnindexableFiles` at `:248`. Pinned by
`doctor.test.ts:253` (`toBeUndefined`) and `:240` (`toEqual([])`). Warning kinds today:
`["unindexable_file", "unindexable_files_truncated"]` (`unindexable.ts:42`). Warnings never move
`ok` and never change the exit code — the CLI prints them **before** the verdict
(`apps/cli/src/commands/db/doctor.ts:25-27`) and exits 0 anyway;
drift throws `CheckFailedError` → `ExitCode.checkFailed` = **6** (`apps/cli/src/errors.ts:15,113-114`).

Drift detection is a three-layer stat-then-hash: rows keyed by path; a `file_hashes` size+mtime
short-circuit that skips reading the file entirely (`doctor.ts:115-140`); SHA-1 re-read only on
mismatch (`doctor.ts:142-163`, `hashContent` at `project-document.ts:432`).

**Therefore, per §14's signed rule**: pending-only is **not** drift and must not produce a `warnings`
entry either if it would confuse the operator — it is `corpus index status`'s business. Chunk drift
(a chunk row whose recorded doc/heading-path/content no longer matches the files) and mixed identity
are drift and must move `ok`. Which drift kind they reuse — or whether they need a new one and hence
a contract change — is Open Conflict 6.

### C15 — CLI-020 is mostly already done, and its "exact wording per state" criterion contradicts CLI-019

CLI-019 shipped the whole degraded-note mechanism (`apps/cli/src/commands/retrieval.ts:28-34`):

```ts
export function semanticIndexNote(state: string | undefined): string | undefined {
  if (state === undefined || state === "current") return undefined;
  return (
    `# ranking is degraded — the semantic index is "${state}" (SPEC.md §9.1); ` +
    "these results are ranked on the lexical half alone."
  );
}
```

It already handles **all four** enum values — deliberately generically, per its own comment at
`:16-20` ("an unknown state is reported by name"). There is no wire-value mapping left to add.
CLI-020's criterion "exact wording per state" would *undo* that design. **Recommendation: keep the
generic wording**; the criterion becomes "fires for each of the three non-`current` values against
real wire values, silent on `current` and on absent".

What is actually left for CLI-020: an `index` topic with two verbs, registration, and
`docs/cli.md` regeneration. Registration is a solved pattern — `dbTopic`
(`apps/cli/src/commands/db/index.ts:11-20`) is `{ name, summary, description, commands }` added to
`topics` in `registry/index.ts:40-58`. `docs/cli.md` is generated
(`npm run docs:cli -w apps/cli`) and drift-tested at `apps/cli/src/docs/generate.test.ts:26-28`
(`expect(committed).toBe(generateCliDocs(registry))`) — **adding a command without regenerating
fails a unit test**, not just a hook.

`--json` needs no work: it is `Output.emit` (`apps/cli/src/output.ts:54-63`), which emits the raw
server envelope as one line and suppresses `Output.line` entirely — so the note is human-only by
construction, and `--json` passthrough is free.

One trap: `db/rebuild.ts:20-26` uses `client.untimedApi` with `REBUILD_TIMEOUT_MS = 10 * 60_000`
because registry validation rejects a local flag shadowing the global `--timeout`. `index rebuild`
returns immediately and must **not** copy that — it uses the ordinary client.

### C16 — three directory names in this batch collide with barrel files

Five server issues propose `apps/server/src/index/{chunker,provider,worker,vectors,routes}.ts`. But
**`apps/server/src/index.ts` already exists** — it is the package's public barrel
(`export * from "./projection/index.js"` etc.). A sibling `index/` directory whose own barrel would
be `index/index.ts` resolves, but every relative import in `src/` becomes a puzzle, and on a
case-insensitive macOS filesystem it is a trap waiting for a rename.

CLI-020 has the identical problem: every topic directory uses `index.ts` as its barrel, so
`apps/cli/src/commands/index/` means `commands/index/index.ts`.

CONTRACT-023 already saw this coming and solved it for itself — its Technical Design says
`routes/index-maintenance.ts` "(new — avoid clashing with the barrel `index.ts`)". The other two
domains should make the same call. Open Conflict 7.

---

## Machine rules — binding on every agent in this batch

### Ports

| Issue | Server port | Notes |
| --- | --- | --- |
| SERVER-042 | 8804 | |
| SERVER-043 | 8805 | + Ollama on its own default 11434 if the agent starts one |
| SERVER-044 | 8806 | |
| SERVER-045 | 8807 | |
| SERVER-046 | 8808 | |
| CLI-020 | 8809 | |
| INFRA-012 | 8810 | packed-install smoke only |
| CONTRACT-023 | — | starts no server |

**`8765` is never bound, never killed, never proxied into** — it is `DEFAULT_PORT`
(`apps/server/src/config.ts:22`) and the maintainer's own workspace. Vite `5282+` if any UI work
appears; none is planned, and **no `npm run e2e` run is authorised in this sprint** — no issue here
touches `apps/ui`.

### Scratch directories

Every workspace an agent creates lives under its own tmp as `s021-<issue-lowercase>/`
(e.g. `s021-server-042/`). **Never `corpus init` inside `/Users/theophanerupin/code/corpus`** — a
`.corpus/` at the repo root is a contract violation, and this sprint's issues all want real
workspaces.

### `npm install` — not authorised, with one conditional exception

No issue in this batch is authorised to add a dependency to any workspace manifest. `sqlite-vec`,
`onnxruntime-node`, `@huggingface/transformers`, `@xenova/transformers`, `fastembed` and `sharp` are
**all** blocked pending Open Conflicts 1 and 2. SERVER-043 ships against a **test double** and the
Ollama HTTP path (which needs no dependency — it is `fetch`). SERVER-045 ships the pure-JS scan
(which needs no dependency). If the orchestrator rules an Open Conflict in favour of a dependency,
that ruling is the authorisation and it is quoted in the issue's E2E log.

Probing npm metadata in an isolated scratch package with `--package-lock-only` is always allowed and
never touches the repo.

### Tests and load

- **Scoped only**: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run <path>`. Never the repo-wide
  suite, never unfiltered `npm test`, never `npm run coverage` or `npm run test:coverage`.
- **One workspace-scoped run at the very end of a session is the maximum.**
- **`npm run build` before lint/typecheck/test** — `@corpus/*` resolves through `dist/`.
- **Three concurrent implementation agents maximum**, and the chain below caps the real number at
  two for most of the sprint.
- INFRA-012 runs `npm run package:build` / `pack:check`, which are heavy: **never** while another
  agent's build or test run is alive. It coordinates with the orchestrator before each one.

### Process cleanup — pid-targeted only

`pkill -f vite`, `pkill -f tsx`, `pkill node`, `killall node` are **forbidden** — they kill sibling
agents' servers and the maintainer's. Stop what you started by recorded pid and verify with
`lsof -nP -iTCP:<port> -sTCP:LISTEN`. Agents that start `ollama serve` stop it the same way.

### Grep

**Use `/usr/bin/grep` for any grep-based evidence.** The `rtk` proxy has produced false negatives.
Every "X appears nowhere" claim pastes the `/usr/bin/grep` command that produced it.

### Deferred verification is recorded, not skipped

Any criterion that cannot be executed is marked `STRUCK → Open Conflict N` or `DEFERRED → <reason>`
in the E2E Verification Log, **with the reason and the substitute evidence**. Silent omission is a
fail. Each agent states `implemented on: opus | fable` per CLAUDE.md's record-actuals rule.

### The rebuild-first rule

Because SCHEMA_VERSION goes 8 → 9 (C1), **every E2E procedure in this batch begins with
`corpus db rebuild`** against a workspace created by the current build. An agent that reports
"`db doctor` errored" without having rebuilt has reported C1, not a bug.

---

## Acceptance Tests

### SERVER-042: Deterministic heading-path chunker, content-addressed identity

Model: **opus**. Port `8804`. Read C1, C2, C5 and C16 first: the migration pattern does not exist,
the row-diff criterion needs a two-table split to be meaningful, the PR #15 fix needs a ruling
(Open Conflict 3), and the proposed directory name collides with the package barrel.

TEST-823: Same body, same chunks, forever
  Given: any document body
  When: the chunker runs over it twice in one process, and again in a fresh process
  Then: the chunk ids, heading paths, ordinals and boundaries are identical. A property test over
  generated bodies (headings at mixed levels, fences, empty sections, no headings at all) asserts
  it, and the id function is pure — no clock, no counter, no path, no row id.

TEST-824: Chunk id is a function of exactly three things
  Given: a chunk
  Then: its id is derived from **document id, heading path, content** and nothing else. Proven by a
  table: change the content ⇒ id changes; change an enclosing heading ⇒ id changes; change the
  document's **file path** ⇒ id unchanged; change the document's `updated` frontmatter ⇒ id
  unchanged; change a *sibling* section ⇒ this chunk's id unchanged.

TEST-825: A one-section edit recomputes one section
  Given: a seeded document with 10 heading sections, fully chunked, and a recorded set of
  `chunk_embeddings` rows (C2's second table) with stub vectors
  When: one line inside section 5 is edited and the document is re-projected
  Then: exactly one `chunk_embeddings` row is marked pending; the other nine rows are **untouched**
  — same vector bytes, same `updated_ms`. The test asserts the count and names the surviving rows.
  This is the criterion the whole issue exists for, and it is measured on the embeddings table, not
  on `chunks`, for the reason in C2.

TEST-826: Move and rename re-index nothing
  Given: a chunked document with stub vectors
  When: the file is moved to another folder and separately renamed (both via the move route, id
  unchanged per SPEC.md §5)
  Then: **zero** chunk ids change and **zero** `chunk_embeddings` rows are marked pending, both
  times. `chunks.doc_id` is the id, never the path.

TEST-827: A heading inside a code fence is not a heading
  Given: a body containing a fenced block whose content includes `## Rates`, and a real `## Rates`
  heading later
  Then: the chunker produces one `Rates` section, not two, and the fenced text belongs to the
  section that encloses the fence. The fence-aware line parser is the same rule
  `enclosingHeadings` already applies (`search/heading-path.ts:158`, via
  `fencedCodeRanges`/`overlapsRange` from `core/code.ts`) — reused, not re-implemented; a
  duplicate implementation that disagrees with the search path is a fail.

TEST-828: Both fence syntaxes, and an unterminated fence
  Given: bodies using ``` and ~~~ fences, a fence opened and never closed, and a fence indented up
  to three spaces
  Then: the chunk boundaries match `fencedCodeRanges`'s decision in every case. The unterminated
  fence swallows the rest of the document rather than producing phantom sections.

TEST-829: Oversized sections split at a documented budget with stable sub-addressing
  Given: a section far past the size budget
  Then: it splits into sub-chunks whose addressing is stable and ordered (`ord` ascending), the
  budget constant is **exported and documented** with its char-per-token assumption stated in a
  comment (the spec says "~500 tokens", the implementation approximates by chars — the constant
  names both numbers), and appending one paragraph to the *end* of an oversized section changes only
  the last sub-chunk's id.

TEST-830: Turns chunk per turn
  Given: a thread with several turns, some long enough to split
  Then: each turn produces at least one chunk whose heading path is that turn's heading — the same
  `author · ts` rendering `search.ts:134-141` already produces (U+00B7), reused, not re-derived —
  and turn chunks carry the thread's document id.

TEST-831: A document with no headings still chunks
  Given: a body with no ATX heading at all
  Then: it produces at least one chunk whose heading path is the document title, matching
  `enclosingHeadings`'s documented floor ("a passage with no heading above it reports the document's
  title"). Empty headings (`##` with no text) close their level and contribute nothing to the path,
  same as `heading-path.ts:137-139`.

TEST-832: SCHEMA_VERSION goes 8 → 9, and the tables are registered in all three places
  Then: `schema.ts` has `SCHEMA_VERSION = 9`; `chunks` and `chunk_embeddings` appear in
  `PROJECTION_TABLES`; `chunks` appears in `REPOPULATED_TABLES` in children-first order;
  `chunk_embeddings` does **not** (Open Conflict 5). A test asserts all three lists, because a table
  missing from `PROJECTION_TABLES` is invisible to every existing sanity check.

TEST-833: The wipe-and-rebuild path is exercised, not the imaginary migration path
  Given: a database stamped `SCHEMA_VERSION = 8`
  When: the server opens it read-write
  Then: `openProjectionDatabase` logs `projection schema changed; rebuilding from files`, deletes
  the file, and recreates it empty — and the boot catch-up repopulates. **And**: opening the same
  stale database read-only throws `ProjectionError` naming `corpus db rebuild`
  (`db.ts:294-301`). The E2E log states that no migration code was written (C1).

TEST-834: `db rebuild` reconstructs chunks identically
  Given: a workspace with a populated `chunks` table
  When: `corpus db rebuild` runs
  Then: the `chunks` rows after the rebuild are **identical** to before — same ids, heading paths,
  ordinals, offsets — asserted as a full-table comparison, not a count.

TEST-835: `/api/search` heading paths come from chunks, and the on-read derivation is gone
  Given: the corpus of fixtures `search.test.ts` already covers
  When: `/api/search` runs
  Then: every `headingPath` in every existing search test is **unchanged**, and
  `/usr/bin/grep -rn "locatePassage\|enclosingHeadings" apps/server/src/search/` shows the on-read
  derivation removed from the hit path (the functions may survive as chunker internals; what must
  not survive is `/api/search` deriving an address at read time).

TEST-836: The repeated-passage fixture — the PR #15 class, closed
  Given: a document containing byte-identical boilerplate under `## Alpha` and under `## Omega`,
  and a query matching only that boilerplate
  When: `/api/search` runs and the hit's best passage is genuinely the one under `## Omega`
  Then: `headingPath` reports `Omega`. Today `locatePassage`'s `text.indexOf(window)` reports
  `Alpha` unconditionally (C5). **This test is gated on Open Conflict 3**: if the ruling is option B,
  it is restated as "the address is deterministic and the ambiguity is documented", and marked
  `STRUCK → Open Conflict 3` with the ruling quoted.

TEST-837: The chunker does not move Phase A's search output
  Given: the full existing `apps/server/src/search/` and `apps/server/src/docs/related.test.ts`
  suites
  Then: they pass **with no assertion edited**, and the E2E log pastes the two suite results. The
  one permitted exception is TEST-836's fixture, named explicitly.

TEST-838: E2E — a real edit on a real server
  Given: a workspace on port `8804` seeded with a large multi-section document, after
  `corpus db rebuild`
  When: a one-line edit is saved through `PUT /api/docs/{id}`, and `sqlite3` dumps `chunks` and
  `chunk_embeddings` before and after
  Then: the log pastes both dumps and the diff, showing exactly one section's chunk changed; then
  `corpus db rebuild && corpus db doctor` is clean, pasted.

### SERVER-043: Embedding provider seam — local-first, sticky identity

Model: **opus**. Port `8805`. Read C9 first: reachability is not usability. Ships against a test
double and the Ollama HTTP path only — **no npm dependency is authorised** (Open Conflict 1).

TEST-839: The interface is narrow and the identity is one string
  Then: `EmbeddingProvider` exposes an embed-a-batch method returning vectors, plus a stable
  `identity` of the documented form `provider/model@dim` (e.g. `ollama/nomic-embed-text@768`). The
  dimension in the identity is **read from the provider's first response**, never assumed from a
  table — a test asserts that a stub returning 384-dim vectors under a model whose name suggests
  768 produces `@384`.

TEST-840: Resolution order, proven as a table
  Given: stubbed probes
  Then: config-declared provider wins over a reachable local runtime, which wins over the bundled
  path. All three legs are asserted, plus the two-of-three and one-of-three cases.

TEST-841: A probe failure falls through silently
  Given: no local runtime (connection refused), no config
  Then: resolution proceeds to the next candidate with **no error surfaced to any caller** and no
  stack trace logged at error level. One `info`-level line at most, once.

TEST-842: A reachable runtime with no embedding model also falls through (C9)
  Given: a local runtime answering `GET /api/tags` with only chat models
  Then: it is **not** selected, and the fall-through is silent — identical to unreachable. A
  runtime answering `/api/embed` with a 404 mid-run is a provider *failure* (SERVER-044's backoff),
  not a re-resolution.

TEST-843: A configured provider that cannot be reached fails loudly
  Given: `.corpus/config.json` declaring an embedding provider whose endpoint refuses connections
  Then: the index enters an explicit **error state**, surfaced (SERVER-046 renders it); it does
  **not** silently fall back to the local runtime or the bundled model. The test asserts both
  halves — the error state is present *and* no other provider was resolved. This is the one place
  where loud beats graceful, and the reason is in the issue: a configured choice failing loudly is
  not the same event as zero-config falling back.

TEST-844: Identity is recorded on first index write
  Given: a fresh workspace
  When: the first chunk is embedded
  Then: the identity string lands in index metadata inside the same transaction as the vector. A
  vector with no recorded identity is unreachable by construction.

TEST-845: Stickiness — a better runtime appearing changes nothing
  Given: an index built with identity X while no local runtime was reachable
  When: the server restarts with a local runtime now reachable and offering a different model
  Then: the recorded identity is still X, it is still used, and **nothing is queued**. The test
  asserts the pending count is unchanged across the restart. This is the criterion that makes the
  §9.1 promise ("never as a surprise background rebuild") true.

TEST-846: Identity changes only through an explicit act
  Given: a sticky index at identity X
  Then: editing `.corpus/config.json` to declare a different provider changes it, and
  `POST /api/index/rebuild` changes it (SERVER-046 wires the verb). A restart, a `db rebuild`, a
  newly-reachable runtime, and a version upgrade each change **nothing** — four negative cases, each
  asserted.

TEST-847: Identity mismatch at startup is detected and reported, not acted on here
  Given: an index recorded at identity X and a resolved provider at identity Y
  Then: SERVER-043 exposes a check that reports the mismatch. It does **not** wipe anything —
  SERVER-044/046 own the invalidation. The seam is a function with a return value, asserted
  directly.

TEST-848: The bundled path performs no network access
  Given: the bundled provider (the test double until Open Conflict 1 is ruled)
  When: it embeds a batch with `fetch` and `http`/`https` stubbed to throw
  Then: it succeeds. Any network call is a fail.

TEST-849: No key material is ever logged
  Given: a config-declared external provider with an API key
  When: resolution runs, succeeds, and separately fails
  Then: `/usr/bin/grep` over every captured log line finds the key nowhere, in either path — not in
  a URL, not in an error message, not in a serialised config dump. The redaction is asserted, not
  assumed.

TEST-850: The config block parses permissively and refuses at boot
  Given: `WorkspaceConfigSchema` is non-strict by design (`config.ts:64-67`: "unknown keys pass
  through") and the **CLI shares this reader** (`:41-43`, `:64`)
  Then: the new embedding block is **optional** on the schema (the `attachments` precedent,
  `config.ts:83-93`), a workspace with no block parses unchanged, and a block naming a provider this
  build cannot serve is refused or warned **at boot**, in the shape `dataDir` already uses
  (`config.ts:119-126`) — never at parse time, which would break the CLI's reader. Non-fatal
  problems go through `config.warnings` (`config.ts:327-332`), which `lifecycle.ts:146-148` already
  logs.

TEST-851: E2E — zero config on a real server
  Given: a workspace on port `8805` with no embedding config and no local runtime
  When: the server boots and a document is saved
  Then: `sqlite3` shows the recorded identity in index metadata (SERVER-046's endpoint does not
  exist yet); then a config block pointing at a dead endpoint is added, the server restarts, and the
  loud error state is pasted from the log and from `sqlite3`. If the agent starts `ollama serve` for
  the reachable-runtime leg, it records the pid, pulls `nomic-embed-text` **outside the repo**, and
  stops it afterwards (C9).

### SERVER-044: Async embed worker — never blocks writes, visible staleness

Model: **opus**. Port `8806`. Read C11, C12 and C13 first: the lifecycle hole, the four hook points,
and the rename hazard.

TEST-852: The write path does not wait
  Given: a provider stub whose embed call sleeps 5 seconds, and the worker saturated
  When: `PUT /api/docs/{id}` is issued
  Then: the response returns in the normal envelope, well under the sleep, and the request's own
  latency is asserted against a bound — not merely "it returned". The chunk is pending afterwards.

TEST-853: All four pending sources enqueue
  Given: an empty pending set
  Then: each of (a) a server save through `runMutation` (`write.ts:755-761`), (b) a watcher-detected
  out-of-band edit (`watcher.ts:239-305`), (c) `db rebuild` (`populate.ts:48`), and (d) an
  identity-mismatch invalidation (SERVER-043's check) marks chunks pending. Four separate cases,
  each asserting the count delta, and each naming the hook point it exercised.

TEST-854: Draining updates counts transactionally
  Given: a batch of N chunks pending
  When: the worker drains one batch
  Then: `indexed` rises by exactly the batch size and `pending` falls by it, and at no observable
  point does `indexed + pending + failed` disagree with the chunk total. Asserted by reading counts
  from a second connection between batches.

TEST-855: Kill mid-batch leaves no half-indexed chunk
  Given: a worker mid-drain
  When: the process is killed (`SIGKILL`, not a graceful close)
  Then: on restart every chunk is either fully `indexed` with a vector and an identity, or `pending`
  with neither. No row carries a vector without an identity, or an identity without a vector. The
  pending count on restart is correct — derived from the rows, not from a persisted counter.

TEST-856: Clean shutdown is clean, and the ordering is the reason
  Given: a saturated worker
  When: `SIGTERM` arrives
  Then: `close()` completes within `SHUTDOWN_GRACE_MS = 5000`, the worker's disposer runs **before**
  `db.close()` (because it registered after `attachProjection`, C11), and the in-flight batch is
  abandoned to `pending` rather than half-written. The test asserts the disposer order explicitly —
  reverse-registration is the mechanism (`app.ts:509-516`) and a worker registered in the wrong
  place passes every other test in this section.

TEST-857: The cancellation token is read across every await
  Given: the worker awaiting a provider call
  When: `close()` is called during the await
  Then: the worker returns without touching the database. The token pattern is the watcher's
  (`cancelled: () => stopped`, `attach.ts:45`; rationale `catch-up.ts:81-86`). A test that closes
  mid-await and then asserts no post-close write is the proof.

TEST-858: The worker survives `db rebuild`'s rename
  Given: a worker holding the `ProjectionDb` (C13)
  When: `POST /api/db/rebuild` runs its `reopenAround` swap while the worker is draining
  Then: the worker continues against the new connection without error, because `ProjectionDb`'s
  object identity is stable and the statement cache is cleared for it (`db.ts:198`). **And**: a
  test asserts the worker holds no prepared `Statement` across an `await` — the failure this test
  exists for is invisible until a rebuild happens in production.

TEST-859: Repeated provider failure backs off
  Given: a provider stub failing every call
  Then: retry intervals grow (the schedule is a documented constant, asserted), the worker does not
  spin, and the failure is logged at most once per backoff window — not once per attempt.

TEST-860: A permanently failing chunk is counted, never dropped
  Given: one chunk whose embedding always fails and 20 that succeed
  Then: after the drain, `failed == 1`, `indexed == 20`, `pending == 0`, and the failing chunk is
  still identifiable in the table (state + failure count). It is never silently deleted and never
  silently marked indexed.

TEST-861: One bad chunk does not starve the rest
  Given: the same fixture, with the bad chunk first in queue order
  Then: the 20 good chunks are indexed. A batch that aborts on its first failure fails this test.

TEST-862: Batch progress under a slow provider is incremental
  Given: a provider taking 200 ms per batch and 500 chunks pending
  Then: counts read from a second connection strictly decrease over time — progress is observable
  mid-drain, not only at the end. This is what makes SERVER-046's status endpoint worth having.

TEST-863: The worker is inert when disabled, and tests drive it directly
  Then: `intervalMs: 0` (the SSE heartbeat convention, `events/sse.ts:126`) means the worker never
  self-schedules, and every test in this section drives it by calling `tick()` — no `vi.useFakeTimers`
  for the worker's own scheduling, matching the watcher's convention. Any timer it does create is
  `unref`'d (`watcher.ts:456`); a test asserts the process can exit with the worker attached.

TEST-864: Debounce behind the write path
  Given: ten rapid saves to the same document
  Then: the worker embeds the final content once, not ten times — the same shape the watcher's
  debounce-and-max-batch loop provides (`watcher.ts:402-448`), including its **first-entry livelock
  guard**: a single pending chunk under continuous churn still gets embedded.

TEST-865: Counts are derived, and a rebuild cannot desync them
  Given: any state
  Then: `indexed` / `pending` / `failed` are computed from `chunk_embeddings` rows, not from a
  counter that a crash or a rename could leave stale. Asserted by mutating rows directly and reading
  the counts back.

TEST-866: E2E — bulk import while saves stay instant
  Given: a workspace on port `8806` after `corpus db rebuild`, and 200 seeded documents
  When: documents are saved in a loop while `sqlite3` polls the counts
  Then: the log pastes the count trajectory draining to zero and the per-save latencies staying flat;
  then `kill -9` mid-drain, restart, and the counts converge with no half-indexed row (pasted).

### CONTRACT-023: index routes, staleness values, `similar` rows

Model: **opus**. No server. **Parallel from the start** — it blocks SERVER-045, SERVER-046 and
CLI-020, so it goes first in wall-clock terms. Read C3: the enum does not widen.

TEST-867: The enum is not touched
  Then: `/usr/bin/grep -n "SEMANTIC_INDEX_STATES" packages/contract/src/schemas/retrieval.ts` shows
  `["current", "indexing", "stale", "disabled"]`, byte-identical to today. No value added, none
  renamed, `catching-up` and `lexical-only` appear nowhere in the repository. The issue's own
  wording is wrong (C3) and the E2E log says so.

TEST-868: `RELATIONS` is not touched either
  Then: `RELATIONS = ["linked", "similar", "both"]` is unchanged. `similar` and `both` have been
  parseable since CONTRACT-022; this issue makes them **producible**, which is a server change, not
  a contract change. The only permitted contract edit here is documentation prose.

TEST-869: `GET /api/index/status` is defined with an honest schema
  Then: the route declares a response carrying **indexed, pending and failed counts, the recorded
  provider/model identity (nullable — a fresh workspace has none), a rebuild-in-progress flag, and
  the semantic state**. The state field **reuses `SemanticIndexStateSchema`**, so `/api/search` and
  `/api/index/status` cannot disagree about the same workspace by construction. Read-only.

TEST-870: `POST /api/index/rebuild` carries no acting party
  Given: SPEC.md §9.2's index bullet — "Both touch only derived runtime state — no workspace file
  changes, no git commit, **no acting party**"
  Then: the route definition has **no `ActorHeaderSchema`** in its `request`. This is a deliberate
  divergence from `POST /api/db/rebuild`, which *does* carry one (`routes/db.ts:34-56`), and the
  divergence is documented in the route file. A test asserts the absence.

TEST-871: The rebuild response is fire-and-forget and still useful
  Then: the response type is honest about having returned before the work finished. **Recommended
  shape (Open Conflict 8): it returns the `IndexStatus` snapshot taken immediately after queueing** —
  every field is true at the moment of the call, the CLI has something to print, and no new schema is
  invented. Whatever is chosen, it is not a bare `204` and not a promise of completion.

TEST-872: Both routes land in `ENDPOINT_INVENTORY` and the inventory test passes
  Then: `"GET /api/index/status"` and `"POST /api/index/rebuild"` are entries in
  `ENDPOINT_INVENTORY` (plain strings — `inventory.ts:39-104`), spelled exactly as §9.2 spells them.
  `inventory.test.ts` compares the sorted inventory against the **committed `openapi.json` read from
  disk**, so this test is only green after regeneration.

TEST-873: `openapi.json` and the client regenerate with no diff
  Then: `npm run generate -w packages/contract` from the committed tree produces no diff, and the
  generated-artifacts drift check is green. The generated client exposes both new operations, typed.

TEST-874: Phase A compatibility is asserted in a test, not reviewed
  Then: a type-level test constructs a value against the **CONTRACT-022-era** `SearchResults`,
  `SearchHit`, `RelatedDocs` and `RelatedDoc` shapes and assigns it to the current types — it must
  still typecheck. Every field that existed is still present with the same type and the same
  optionality. A widened enum or a newly-required field fails here.

TEST-875: `semanticIndex` stays optional on both envelopes
  Then: it is still `.optional()` on `SearchResultsSchema` and `RelatedDocsSchema`. Phase A's
  honest answer is *absence* (C4), and a server that has no index must be able to keep saying
  nothing.

TEST-876: The route file does not clash with the barrel
  Then: the file is `packages/contract/src/routes/index-maintenance.ts`, per the issue's own
  Technical Design, and `routes/index.ts` remains the barrel. (C16 — the other two domains face the
  same problem; Open Conflict 7.)

TEST-877: Schema round-trips
  Then: the status schema round-trips through parse/serialize for: a fresh workspace (null identity,
  all counts zero, `disabled`), a draining workspace (`stale`, pending > 0), a rebuilding workspace
  (`indexing`, rebuild flag true), a caught-up workspace (`current`), and a workspace with failures
  (`failed > 0`). Five named fixtures — they are also SERVER-046's and CLI-020's fixtures.

TEST-878: Nothing else in the contract moved
  Then: `git diff --stat packages/contract` touches only the new route file, `inventory.ts`, the
  regenerated artifacts, and documentation prose in `retrieval.ts`. `schemas/retrieval.ts`'s
  **executable** content is byte-identical — asserted by pasting the diff.

### SERVER-045: Vector storage, hybrid ranking, `similar` related rows

Model: **opus**. Port `8807`. Read C6 and C7 first: the ranking is one SQL statement with `LIMIT`
inside it, and the brute-force scan is the primary implementation, not a fallback (Open Conflict 2).

TEST-879: The paraphrase pair — the demo that vectors work
  Given: two documents that share **no** content words, seeded as a fixture and verified by a test
  that intersects their token sets and asserts the intersection is empty (excluding stopwords), e.g.
  a document about "quarterly revenue growth slowed" and one about "sales fell off in the last three
  months"
  When: a query matching one lexically is issued against `/api/search`
  Then: the other appears in the hits, and `GET /api/docs/{id}/related` on the first labels the
  second **`similar`**. Neither is possible on the lexical half, which is the point. Run against a
  real provider in E2E and against hand-set vectors in unit tests.

TEST-880: `both` is produced when a document is linked *and* similar
  Given: two documents that are semantically similar and also connected by a `[[ref]]`
  Then: the related row's relation is `both`, not `linked` and not `similar`. Today `related.ts:113`
  hardcodes `relation: "linked"`; this test is the one that proves the hardcode is gone.

TEST-881: Fusion is deterministic
  Given: hand-set vectors and a fixed lexical corpus
  When: the same query runs twice in one process and again in a fresh process
  Then: byte-identical hit order both times. Reciprocal-rank fusion's tie-break is documented and
  falls back to the existing rule — `d.id ASC` (`filters.ts:153`) — so a tie can never depend on
  row-visit order.

TEST-882: The lexical half is over-fetched, and the constant is named
  Given: C6 — `LIMIT @limit` is applied inside the SQL (`search.ts:65`)
  Then: fusion fetches more than `limit` lexical candidates before fusing, the over-fetch factor is
  an exported documented constant, and a test proves a document ranked 11th lexically but 1st
  semantically **reaches the top of a `limit=10` result**. Without the over-fetch this is silently
  impossible and every other test still passes.

TEST-883: A lexical-only workspace gets byte-identical Phase A results
  Given: a workspace with no semantic index (no provider resolved)
  When: every fixture in the existing `search.test.ts` and `related.test.ts` suites runs
  Then: the `hits` array — ids, order, `title`, `snippet` — and the `related` array are **byte-
  identical to Phase A**, with the single documented exception of TEST-836's repeated-passage
  fixture. The only response delta is the newly-present `semanticIndex: "disabled"`. This is the
  sprint's central regression test and it is asserted as a serialized-JSON comparison, not
  field-by-field.

TEST-884: `disabled` — no usable index
  Given: no resolved provider / no recorded identity / zero vectors
  Then: search and related both report `disabled`, both return full lexical results, and neither
  returns an error. Three sub-cases, asserted separately.

TEST-885: `stale` — an incremental backlog
  Given: a usable index with `pending > 0` and no rebuild in flight
  Then: both endpoints report `stale`, and the semantic half **still contributes** what it has —
  degraded is not disabled. A test asserts that an already-indexed semantic neighbour still surfaces
  while other chunks are pending.

TEST-886: `indexing` — a rebuild in flight
  Given: `POST /api/index/rebuild` has queued everything
  Then: both endpoints report `indexing`, not `stale`, for as long as the rebuild flag is set —
  even though pending > 0 in both states (C3, Open Conflict 4).

TEST-887: `current` — caught up
  Given: pending == 0, failed == 0, identity recorded, no rebuild
  Then: both endpoints report `current`, and the field is **present**. The Phase A tests asserting
  `"semanticIndex" in results === false` (`search.test.ts:446-447`, `related.test.ts:245`) are
  updated as a deliberate, called-out change (C4), and the E2E log quotes the before/after.

TEST-888: A query-embedding failure degrades the single request, never 500s
  Given: a healthy index and a provider that fails on this one query embedding
  When: `/api/search` is called
  Then: 200, full lexical results, and the state field says the ranking is degraded. Not a 500, not
  an empty list, not a silent `current`.

TEST-889: An identity mismatch degrades rather than mixes
  Given: vectors recorded at identity X and a resolved provider at identity Y
  Then: the semantic half is **not consulted** — results from different models are never mixed
  (SPEC.md §9.1) — the state is honest, and a full rebuild is queued. A test asserts that not one
  X-identity vector influenced the ranking.

TEST-890: Vector storage round-trips exactly
  Given: a vector written and read back
  Then: the float values are bit-identical. The storage encoding (`Float32Array` → BLOB) and the
  dimension are asserted, and a stored vector whose length disagrees with the recorded `dim` is
  rejected at write time rather than corrupting a scan.

TEST-891: The scan is the implementation, and its cost is measured in the log
  Given: Open Conflict 2's recommended ruling (pure JS, no native extension)
  Then: `vectors.ts` implements brute-force cosine KNN behind an interface, and the E2E log records a
  measured query time at the fixture's chunk count against C7's table (1.19 ms @ 1k×384,
  3.27 ms @ 10k×384). If the extension is ruled in instead, the parity test between the two paths is
  required and this test is restated.

TEST-892: Aggregating chunks to documents is documented and deterministic
  Given: a document whose several chunks all match semantically
  Then: it appears **once** in both endpoints, ranked by a documented aggregation (best chunk, not a
  sum — a long document must not out-rank a precise one merely by having more chunks), and the
  chunk that represents it is the one whose heading path is reported. This mirrors the lexical half's
  existing `MIN(h.ref)` rule (`search.ts:53`).

TEST-893: Filters apply to the semantic half too
  Given: the fourteen shared structured filters (`docFilterShape`)
  Then: a semantically-perfect match that fails a filter (archived by default, wrong `type`, wrong
  `folder`) does **not** appear. Asserted for `includeArchived`, `type` and `folder` at minimum —
  a semantic path that bypasses the archived default would leak archived documents into every
  search.

TEST-894: The `related` document is never its own neighbour
  Then: a document's own chunks never make it a related row of itself, in any state. The Phase A
  guarantee (`related.ts:65`, `id <> @id`) holds for the semantic half.

TEST-895: E2E — real provider, real paraphrases
  Given: a workspace on port `8807` after `corpus db rebuild`, seeded with the TEST-879 pair and
  indexed through a real provider (Ollama if the agent starts one, else the double, stated in the
  log)
  When: `corpus search` and `corpus doc related` run against the real bin
  Then: the paraphrase is found and labeled `similar`, pasted; then the identity is corrupted in
  `sqlite3` and the same queries return full lexical results with an honest state, pasted.

### SERVER-046: index endpoints, rebuild queueing, doctor drift-vs-staleness

Model: **opus**. Port `8808`. Read C14 first: the doctor's shape, the warnings asymmetry, and the
fact that a new drift kind is a **contract** change.

TEST-896: `GET /api/index/status` is live and accurate under a draining worker
  Given: a worker mid-drain
  When: status is polled repeatedly
  Then: counts strictly progress and always sum to the chunk total; the identity and rebuild flag
  are correct at each poll. Read from the same handle the worker uses — a status endpoint reading a
  stale snapshot passes a static test and fails this one.

TEST-897: Status reports the five fixture states
  Then: the five CONTRACT-023 fixtures (TEST-877) each produce the expected status payload, and the
  `state` field agrees with what `/api/search` reports for the same workspace at the same moment.
  Asserted by calling both in one test.

TEST-898: `POST /api/index/rebuild` returns immediately
  Given: 500 indexed chunks
  When: rebuild is called
  Then: the response arrives well under the time it takes to re-embed one batch (asserted against a
  bound, with a deliberately slow provider), the rebuild flag is set, and status shows everything
  queued. No polling loop server-side.

TEST-899: `index rebuild` re-picks the identity — the one place stickiness resets
  Given: a sticky index at identity X, and a now-reachable runtime offering Y
  When: `POST /api/index/rebuild` runs
  Then: the recorded identity becomes Y, and every old vector is discarded rather than reused.
  Complements TEST-846's four negative cases: this is the positive one.

TEST-900: `db rebuild` keeps the identity and queues re-indexing
  Given: an index at identity X
  When: `POST /api/db/rebuild` runs
  Then: the identity is still X, the synchronous projection work completes before the response
  (§2.2 rule 1: "restores everything else synchronously and queues semantic re-indexing"), and
  whatever semantic work remains is queued rather than awaited. What "remains" means depends on
  Open Conflict 5's ruling: under the recommendation, surviving embeddings re-attach by content
  address and only genuinely new chunks queue — assert the queued count is **zero** for an unchanged
  corpus, which is the observable difference between the two rulings.

TEST-901: The §2.2 invariant — `rebuild && doctor` clean while indexing is in flight
  Given: a workspace with a large pending backlog and a deliberately slow provider
  When: `corpus db rebuild && corpus db doctor` runs
  Then: doctor is **clean, exit 0**, immediately, with `pending > 0`. This is SPEC.md §14's signed
  rule ("treats pending asynchronous indexing as staleness, not drift, so `rebuild && doctor`
  remains immediately achievable") and it is the single most important test in this issue.

TEST-902: Doctor fails on chunk drift, with a named reason
  Given: a seeded fixture where a `chunks` row's recorded content hash no longer matches the file
  (written directly via `sqlite3`, since the projector would never produce it)
  Then: `ok === false`, the drift entry names the path and says what disagreed, and the CLI exits
  **6** (`ExitCode.checkFailed`). Separate fixtures for a mismatched heading path and a chunk whose
  document no longer exists.

TEST-903: Doctor fails on a mixed-identity index
  Given: vectors recorded under two different identity strings in one workspace
  Then: `ok === false` with a reason naming both identities. §9.1: "results from different models
  are never mixed" — an index that silently contains two is drift, not staleness.

TEST-904: Pending-only never moves `ok`, and never becomes a warning either
  Given: a workspace whose only anomaly is `pending > 0`, and separately one with `failed > 0`
  Then: `ok === true` and exit 0 in both cases. Whether a persistently-failing chunk deserves a
  report-only **warning** (the SERVER-038 surface, `unindexable.ts:42`) is Open Conflict 9 —
  whichever way it is ruled, `ok` and the exit code do not move.

TEST-905: The warnings asymmetry survives
  Then: `inspectProjection` still returns **no `warnings` key** (`doctor.test.ts:253`) and
  `doctor()` still returns an array (`:240`). The boot catch-up must not start paying for a semantic
  pass — a semantic check added to `inspectProjection` would run on every boot and is a fail.

TEST-906: The drift-kind decision is explicit
  Then: the E2E log states whether chunk drift and mixed identity reuse an existing `DriftKind` or
  required a new one — and if a new one, that `packages/contract/src/schemas/db.ts:94-101` was
  updated and the artifacts regenerated. A server-side kind the contract does not know about is a
  silent wire lie (C14, Open Conflict 6).

TEST-907: The doctor pass stays cheap
  Given: a warm workspace of 200 documents
  Then: the semantic check does not read document bytes that the existing `file_hashes` stat
  short-circuit (`doctor.ts:115-140`) would have skipped. Asserted against `stats.hashed`, which
  must not rise for an untouched workspace.

TEST-908: Both routes are mounted and authenticated
  Then: both require the workspace bearer token like every route except the documented exceptions;
  both are registered against the CONTRACT-023 definitions (the server "cannot serve a shape the
  contract doesn't declare", §9.3); and `GET /api/index/status` is read-only — it starts no work and
  mutates nothing, asserted by comparing counts before and after 100 polls.

TEST-909: E2E — the operational loop on a real server
  Given: a workspace on port `8808` after `corpus db rebuild`
  When: `curl` status mid-drain, then `POST /api/index/rebuild`, then poll again, then
  `corpus db doctor` while pending > 0
  Then: the log pastes the mid-drain status, the reset, the drain trajectory, and a **clean doctor
  with pending > 0** — plus a seeded-drift run showing exit 6 with its reason.

### CLI-020: `corpus index status` / `corpus index rebuild`

Model: **opus**. Port `8809`. Read C15 first: the degraded note already exists and handles all four
values; the real work is two verbs and a docs regeneration.

TEST-910: The topic is registered without colliding with a barrel
  Then: an `index` topic exists with `status` and `rebuild`, registered in `registry/index.ts`
  alongside `dbTopic`, and the directory is **not** `apps/cli/src/commands/index/` (C16, Open
  Conflict 7). Registry validation passes at module load.

TEST-911: `corpus index status` prints one compact, stable-ordered block
  Given: each of the five CONTRACT-023 fixture states
  Then: one block per state with a fixed field order — identity, indexed, pending, failed,
  rebuilding — rendered through the existing `renderColumns` (`commands/columns.ts:18-29`) so it
  matches every other verb. A fresh workspace with a null identity prints something readable, not
  `null` or `undefined`.

TEST-912: `--json` is raw passthrough
  Then: `corpus index status --json` emits **exactly one line**, the server envelope verbatim, and
  no human line at all — which is free via `Output.emit`/`Output.line` (`output.ts:54-68`) and is
  asserted, not assumed.

TEST-913: `corpus index rebuild` acknowledges and returns
  Then: one acknowledgment line plus a hint to watch `corpus index status`, and the process exits.
  **No polling loop.** A test asserts the client method was called exactly once and that the ordinary
  timed client was used — **not** `client.untimedApi` with `db rebuild`'s 10-minute timeout
  (`db/rebuild.ts:20-26`), because this call returns immediately (C15).

TEST-914: The degraded note fires for the three non-current states
  Given: stubbed client responses carrying each real wire value
  Then: `corpus search` prints the note for `indexing`, `stale` and `disabled`, and prints nothing
  for `current` and for an absent field. The wording stays CLI-019's single generic line (C15) — the
  issue's "exact wording per state" criterion is corrected in the E2E log rather than implemented.

TEST-915: The note is a comment line and does not pollute machine output
  Then: it starts with `# `, is a single line with no newline inside, and is **absent** under
  `--json` — the existing `retrieval.test.ts:12-41` assertions still pass unmodified.

TEST-916: `corpus doc related` degrades the same way
  Then: the same note appears on related output for the same states, since both envelopes carry the
  field and Phase B degrades both rankings together.

TEST-917: `docs/cli.md` regenerates and the drift test passes
  Then: `npm run docs:cli -w apps/cli` is run and the result committed;
  `apps/cli/src/docs/generate.test.ts` (`expect(committed).toBe(generateCliDocs(registry))`) is
  green. A stale `docs/cli.md` is a **unit test failure** here, not only a pre-push failure (C15).

TEST-918: Help renders at all three levels
  Then: `corpus --help` lists the `index` topic, `corpus index --help` lists both verbs, and
  `corpus index status --help` renders from the registry. Consistent with SPEC.md §2.3's
  self-documenting registry.

TEST-919: E2E — through the real bin
  Given: a workspace on port `8809`, a slow provider, after `corpus db rebuild`
  Then: `corpus index status` mid-drain shows honest counts (pasted); `corpus index rebuild` returns
  in well under a second with its acknowledgment (pasted, with timing); `corpus index status` after
  it shows the reset; `corpus search <q>` prints the degraded note (pasted); the same with `--json`
  emits one line and no note (pasted).

### INFRA-012: package the bundled model + native vector extension

Model: **opus**. Port `8810`. **Last in the sprint, and its scope depends entirely on Open Conflicts
1 and 2.** Read C10 before anything: the numbers are the issue.

**This issue does not start until both conflicts are ruled.** Under the recommended rulings it has
no deliverables and should be deferred rather than implemented — TEST-920 and TEST-921 are then the
whole issue.

TEST-920: The size case is stated with measured numbers before any artifact is staged
  Then: the E2E log opens with C10's table — the 2.94 MiB baseline, the 21.9 MiB int8 model, the
  258.3 MiB `onnxruntime-node` with its `postinstall`, and the ~100× total-footprint multiplier —
  and states which ruling it is implementing. The issue's own instruction is to "say so loudly rather
  than shipping it silently"; this test is that instruction made checkable.

TEST-921: The pure-JS path is provably reachable with no native artifact present
  Given: a packed install with no vector extension staged (the state under Open Conflict 2's
  recommendation, and also the "extension absent" state under any other ruling)
  When: the tool indexes and searches
  Then: semantic search works via the scan, or reports `disabled` honestly — never an error, never a
  silent lexical result claiming to be `current`. This test is required **under every ruling**.

TEST-922: (if a model is bundled) It is a staged tree, audited in both directions
  Then: the artifact is staged like `assets/` — never reached out of `node_modules`, which
  `FORBIDDEN_PACK_PATTERNS` bans (`pack-audit.ts:91-94`) — and it gains a named entry in
  `REQUIRED_PACK_ENTRIES` with a `reason` string, so its disappearance is a pack failure rather than
  a silent runtime one. A negative rule forbids dev-only model caches leaking.

TEST-923: (if a model is bundled) The resolver finds it from the installed layout
  Then: the loader resolves the model from the packed layout, not from a repo-relative path — the
  same class of bug `serverEntryCandidates()` and `resolveUiDistDir` already have required entries
  for. Proven from an install in a scratch prefix, not from the repo.

TEST-924: (if a native extension is staged) It loads on the packed layout
  Then: it loads on this machine's platform through `db.loadExtension` (available — C8), and the
  platform check runs **once** at startup and is logged once. Per-platform artifacts are staged for
  macOS and Linux and each gains a required entry.

TEST-925: `npm run package:build && npm run pack:check` green
  Then: both run to completion with the new rules, output pasted. `MINIMUM_PACKED_FILES = 15` still
  holds, and no forbidden pattern matches. **Coordinated with the orchestrator** — never concurrent
  with another agent's build.

TEST-926: The pack-size delta is recorded as a number
  Then: the log pastes the byte count of `dist-package/` before and after (`find dist-package -type f
  -print0 | xargs -0 stat -f "%z" | awk …` — the same command that produced the 3,084,162 baseline)
  and the delta as a multiplier. If a threshold is agreed, a regression guard is wired; if not, the
  log says the number was recorded and no guard was agreed.

TEST-927: The dependency footprint is recorded too, and is the bigger number
  Then: if any runtime dependency was added, the log pastes `npm ls --omit=dev` and the installed
  size of `node_modules`, and states whether the package now has a `postinstall` in its dependency
  tree. `onnxruntime-node`'s `postinstall: node ./script/install` is a supply-chain and offline-
  install fact, not a footnote.

TEST-928: Offline is actually offline
  Given: a packed install in a scratch prefix
  When: `corpus init` and a full index run with the process's network access disabled
  Then: it completes, or reports `disabled` honestly. A run that quietly downloads a model on first
  index while claiming to be the bundled path fails this test — and if download-on-first-index is
  the ruling, it is *announced*, not silent.

TEST-929: The CI step exists and is wired
  Then: `pack:check` runs in CI with the new rules (it is deliberately not in pre-push — too slow),
  and the E2E log names the workflow and job. If INFRA-012 is deferred under the recommended
  rulings, this is marked `DEFERRED → Open Conflict 1/2` with the ruling quoted.

### Cross-cutting

TEST-930: Phase A byte-stability, end to end, through the real bin
  Given: a workspace with **no** semantic index, on any of the batch's ports, after
  `corpus db rebuild`
  When: `corpus search <q> --json` and `corpus doc related <id> --json` run against the pre-batch
  build and the post-batch build over the identical workspace
  Then: the two JSON documents differ **only** by the added `semanticIndex: "disabled"` field. Every
  hit id, every order position, every `title`, every `snippet`, every `headingPath` (except the named
  repeated-passage fixture), every relation is identical. This is the sprint's headline regression
  check and it is run by the evaluator, not only by the implementing agents.

TEST-931: The §2.2 rule-1 invariant holds at the top level
  Then: `corpus db rebuild && corpus db doctor` is clean on a workspace with a large pending backlog,
  through the real CLI, exit 0, pasted. Derived state is rebuildable; pending is staleness, not
  drift.

TEST-932: The paraphrase pair is found end to end by a real user's commands
  Then: from a fresh workspace, `corpus init` → seed the TEST-879 pair → wait for the drain →
  `corpus search` finds the keyword-disjoint document, and `corpus doc related` labels it `similar`.
  Pasted, from the bin, with a real provider named in the log. If no real provider is available on
  the machine, this is `DEFERRED → provider` with the stub-provider evidence supplied and the
  orchestrator completing it before the PR merges.

TEST-933: Nothing durable landed in SQLite
  Then: deleting `.corpus/cache.db` and running `corpus db rebuild` reconstructs a workspace that
  answers every query the pre-deletion one did — modulo embeddings, which re-derive from the files
  through the provider. `git status` in the workspace is clean: no chunk, vector or index metadata
  is ever committed (`.corpus/` is gitignored by the workspace template).

TEST-934: `SPEC.md` is unchanged
  Then: `git diff SPEC.md` is empty. Every Phase B behaviour in this batch is already signed text
  (SHARED-006 Edits 2, 6, 7, 8, 10, 13). Open Conflict 1 is the one thing that could require a spec
  edit, and if it does, that edit goes to the **user** for sign-off through the orchestrator, never
  from an agent.

TEST-935: The contract shapes did not move
  Then: `git diff packages/contract/src/schemas/retrieval.ts` shows documentation prose only —
  no executable change (TEST-878).

TEST-936: The chain held in commit order
  Then: the commit sequence on the branch is 042 → 043 → 044 → {045, 046} → CLI-020 → (INFRA-012),
  with CONTRACT-023 landing at any point before 045/046. An out-of-order commit means an agent ran
  against a tree that did not yet have its dependency.

TEST-937: No dependency was added without a ruling
  Then: `git diff` over every `package.json` and `package-lock.json` is empty **unless** an Open
  Conflict ruling authorised it, in which case the ruling is quoted in the commit body. `sqlite-vec`,
  `onnxruntime-node`, `@huggingface/transformers`, `@xenova/transformers`, `fastembed` and `sharp`
  appear nowhere in any manifest.

TEST-938: Machine hygiene
  Then: `git status` is clean of scratch escape, `/Users/theophanerupin/code/corpus/.corpus` is
  absent, `8765` was never bound, `5173` was never taken, no `npm run e2e` was run, and every port in
  the table is free at session end (`lsof -nP -iTCP:<port> -sTCP:LISTEN`, pasted).

TEST-939: Coverage holds without a new exemption
  Then: the repo-wide coverage gate passes at harvest at ≥ 90% on all four metrics with **no new
  entry** in `scripts/coverage-config.ts`. A provider seam and a worker are exactly the code that
  tempts an exemption; the stubs exist so they do not need one.

TEST-940: The generated artifacts drift checks are green
  Then: `openapi.json` regenerates with no diff, and `docs/cli.md` regenerates with no diff. Both are
  §14 obligations and both are touched by this batch.

TEST-941: Every issue's E2E log states its model and its deferrals
  Then: each of the eight issue files carries `implemented on: opus | fable`, and every `STRUCK` or
  `DEFERRED` criterion carries its reason and substitute evidence. A log that silently omits a
  criterion fails the sprint, not the criterion.

---

## Out of Scope

- **Phase C, entirely.** `GET /api/threads/{id}/context` (CONTRACT-024), context-pack assembly
  (SERVER-047), `corpus thread context` (CLI-021), and AGENT-009 are Phase 9. SERVER-045 must not
  build a context packer because one is coming.
- **UI.** UI-025 (related-documents panel) and UI-026 (⌘K adopting `/api/search`) are Phase 9. No
  file under `apps/ui/` or `packages/kit/` is touched, and no e2e run is authorised.
- **Widening the semantic-state enum or the relation enum.** Frozen by CONTRACT-022 (C3).
- **New `GET /api/docs` behaviour.** Lists stay lexical and stay on the collection query; §9.2 is
  explicit that `/api/search` is the ranked surface. Semantic ranking does not leak into `sort=relevance`.
- **Reranking, query expansion, HyDE, or any second model.** The spec says lexical + semantic fused;
  it does not say anything else, and one index/one model forbids the rest.
- **Chunk-level results in the API.** Both endpoints return **document** rows. Chunks are an internal
  addressing and ranking mechanism; a chunk id never crosses the wire in this sprint.
- **Embedding attachments, images, or non-markdown content.** Document and turn bodies only.
- **Multi-model or per-type indexes.** One index, one model (§9.1).
- **A publish/npm release.** Provisional package name, no `NPM_TOKEN`, no publish — sprint-013
  Adjudication 9 and the standing user decision stand.
- **Migrating existing users' projections.** There is no migration path by design (C1).
- **`corpus index status --watch` or any polling verb.** CLI-020's issue is explicit: the verb
  returns.

---

## Integration Points

- **CONTRACT-023 produces**: `GET /api/index/status` → `IndexStatus` (indexed, pending, failed
  counts; nullable identity; rebuilding flag; `SemanticIndexState`), and `POST /api/index/rebuild` →
  (recommended) the same `IndexStatus`, taken after queueing, **with no actor header**.
  **SERVER-046 consumes** both as route definitions to register handlers against; **CLI-020
  consumes** both through the generated typed client. Neither may hand-construct a request (§2.2
  rule 4).
- **The `SemanticIndexState` vocabulary is shared by three surfaces** — `/api/search`,
  `/api/docs/{id}/related`, and `/api/index/status`. `IndexStatus` reuses
  `SemanticIndexStateSchema` rather than declaring a parallel enum, so a workspace cannot report
  `current` on one endpoint and `stale` on another (TEST-897 asserts they agree in one call).
- **SERVER-042 produces**: `chunks` (doc_id, chunk_id, heading_path, ord, offsets, content_hash) and
  `chunk_embeddings` (chunk_id PK, identity, dim, vec, state, failures) at `SCHEMA_VERSION = 9`.
  **SERVER-044 consumes** `chunk_embeddings` as its work queue and count source; **SERVER-045
  consumes** both for KNN and for address selection; **SERVER-046 consumes** the counts.
- **SERVER-043 produces**: `EmbeddingProvider` with `identity: "provider/model@dim"`, a resolution
  function, and an identity-mismatch check. **SERVER-044 consumes** the provider; **SERVER-045
  consumes** it to embed the query and consumes the identity to refuse mixing; **SERVER-046
  consumes** the identity for status and re-picks it on `index rebuild`; **INFRA-012 consumes** the
  bundled loading seam.
- **SERVER-044 produces**: the worker handle
  (`{ tick(), counts(), close() }`), an `attachEmbeddingWorkerFn` seam in `lifecycle.ts` registered
  **after** `attachProjection`, and hooks at `write.ts:755-761`, `watcher.ts:428-433`,
  `populate.ts:48`. **SERVER-046 consumes** the counts and the rebuild trigger.
- **SERVER-046 produces**: mounted routes plus the extended doctor pass. **CLI-020 consumes** the
  routes; the evaluator consumes the doctor verdict.
- **INFRA-012 consumes** SERVER-043's loading seam and SERVER-045's storage choice, and produces
  nothing any other issue depends on — which is why it is last and why deferring it costs nothing.
- **Shared fixtures, defined once and reused across five issues**: the five status states
  (CONTRACT-023 TEST-877), the keyword-disjoint paraphrase pair (SERVER-045 TEST-879), the
  repeated-boilerplate document (SERVER-042 TEST-836), and the seeded-drift workspace (SERVER-046
  TEST-902). An issue that invents its own version of one of these has made the cross-issue tests
  unverifiable.

---

## Escalations and Open Conflicts

**Open Conflict 1 — the bundled model is a ~100× install-footprint increase, and it is a product-posture decision.**
Measured (C10): the packed product is **2.94 MiB**. A bundled int8 MiniLM adds **21.9 MiB** to the
tarball; executing it requires `onnxruntime-node` at **258.3 MiB unpacked with a `postinstall`
script**; via `@huggingface/transformers` it also drags in `sharp` and 24 platform packages. Total
~294 MiB against 2.94 MiB today. **Deferring the model download does not help** — it removes 22 MiB
of the ~291 MiB increase. SPEC.md §9.1's signed text says "otherwise a model bundled with the tool",
so this cannot be resolved by an agent.
**Recommendation: ship Phase B as local-runtime-or-configured only.** Zero config with a reachable
Ollama that has an embedding model ⇒ semantic index. Zero config without one ⇒ `disabled` and honest
lexical-only, which is *already* what the frozen contract's `disabled` value means ("no semantic
index is configured — lexical ranking only"). Zero new dependencies, zero pack delta, and the whole
of Phases B and C still work for anyone with Ollama. Then file the bundled/downloaded model as its
own issue once the user has ruled on the footprint — with `download-on-first-index` (announced, not
silent) as the middle option, since it moves the cost to people who opt in.
**This requires a SPEC.md §9.1 amendment** (softening the bundled-model clause), which is a
user-sign-off item the orchestrator prepares — never an agent.
**Escalate to the user.** If the user wants the bundled model regardless, that is a legitimate
answer and INFRA-012 becomes a large issue; it should not be discovered halfway through
implementation.

**Open Conflict 2 — the native vector extension is not worth a native dependency.**
Measured (C7): brute-force cosine over 10,000 × 384-dim vectors is **3.27 ms/query**; reading them
all out of SQLite is **10.8 ms**; 50,000 × 384 is 16.6 ms. `sqlite-vec` is viable
(better-sqlite3 12.11.1 can load extensions — C8) and small (876 KiB for all five platforms), but it
is pre-1.0 and buys nothing at this scale, while costing a native dependency, per-platform staging,
per-platform pack rules, a CI matrix, and a parity test.
**Recommendation: make the pure-JS scan the primary implementation for v1** and keep it behind
`vectors.ts`'s interface so an extension can be added later without touching callers. SERVER-045's
acceptance criterion "degrades when the extension fails to load" becomes vacuous and is restated as
"degrades when there is no usable index". **INFRA-012's second deliverable disappears entirely.**
Revisit only if a real corpus is measured past ~100k chunks.
**Orchestrator can rule this** — it is a measured engineering call inside the server domain, and the
measurement is in C7. It is listed as a conflict only because it contradicts the issue text and
because it removes an INFRA deliverable.

**Open Conflict 3 — closing the PR #15 finding requires chunk-granular matching, which collides with byte-stability.**
The bug is confirmed (`heading-path.ts:120`, `text.indexOf(window)` — first occurrence). But no
offset arithmetic over a document-granular FTS match can identify which of two byte-identical
passages matched (C5). Three options:
- **(A) Add a second FTS5 table, chunk-granular, used only for address selection.** `search` and its
  bm25 ranking are untouched, so hits, order and snippets stay byte-identical; `headingPath` comes
  from the best-matching chunk *within the already-chosen document*. Cost: roughly doubles FTS
  storage. It also gives SERVER-045 a chunk-granular lexical candidate list, which is what
  reciprocal-rank fusion actually wants.
- **(B) Keep doc-granular matching, accept reduced-but-not-eliminated ambiguity.** Rewrite the
  acceptance criterion to "the address is deterministic and the ambiguity is documented"; TEST-836
  becomes a documentation test. Zero cost, finding stays open.
- **(C) Make `search` itself chunk-granular.** Cleanest model, but bm25 scores change with row
  length, so Phase A's ranking moves — which TEST-883 and TEST-930 forbid.
**Recommendation: (A).** It closes the finding, keeps Phase A byte-stable, and pays for itself in
SERVER-045. **Orchestrator rules before SERVER-042 is spawned** — it changes the issue's schema work.

**Open Conflict 4 — `indexing` vs `stale` when both apply.**
A full rebuild always implies pending > 0, so both descriptions fit (C3).
**Recommendation: `indexing` wins whenever a full rebuild is in flight; `stale` otherwise.** It is
the more specific claim and it is what the contract's own wording implies ("a rebuild or backfill is
running" vs "documents are still pending"). Ruled in CONTRACT-023, honoured identically by
SERVER-045 and SERVER-046. **Orchestrator rules.**

**Open Conflict 5 — do embeddings survive `corpus db rebuild`?**
§2.2 rule 1 says a rebuild "restores everything else synchronously and **queues** semantic
re-indexing", which is satisfied either way. But `rebuild.ts` builds into a temp file and
`renameSync`s it into place (C13), so the temp database starts empty — preserving embeddings means
an explicit ATTACH-and-copy of `chunk_embeddings` before the rename.
**Recommendation: preserve them.** Content-addressed chunk ids mean surviving embeddings re-attach
for free, so a `db rebuild` on an unchanged corpus queues **nothing** instead of re-embedding
everything — and re-embedding a 40k-chunk corpus is minutes of CPU, not seconds. `corpus index
rebuild` remains the verb that genuinely discards. Requires: `chunk_embeddings` **excluded** from
`REPOPULATED_TABLES`, the ATTACH-copy in `rebuild.ts`, a garbage-collection pass for orphaned
embeddings, and TEST-900's "queued count is zero" assertion.
**Orchestrator rules** — it changes SERVER-042's table registration and SERVER-046's rebuild
behaviour, so it must be ruled before SERVER-042 is spawned.

**Open Conflict 6 — does semantic drift need a new `DriftKind`, and therefore a contract change?**
`DRIFT_KINDS` is mirrored in `packages/contract/src/schemas/db.ts:94-101` (C14), and CONTRACT-023's
scope does not include it.
**Recommendation: reuse `content_mismatch` for a chunk whose recorded content no longer matches the
file, and `count_mismatch` for a mixed-identity index**, with the `detail` string carrying the
semantic specifics — the existing kinds are about exactly these two relationships and the
`detail` field is already free-form. If SERVER-046 finds the reuse genuinely misleading, the new kind
is a CONTRACT-023 rider and CONTRACT-023 must land it, not the server.
**Orchestrator rules before CONTRACT-023 is spawned** — a rider decided later means regenerating
artifacts twice.

**Open Conflict 7 — three directory names collide with barrel files.**
`apps/server/src/index/` vs the existing `apps/server/src/index.ts`; `apps/cli/src/commands/index/`
vs the topic-barrel convention (C16). CONTRACT-023 already solved its own case
(`routes/index-maintenance.ts`).
**Recommendation: `apps/server/src/semantic/`** (`chunker.ts`, `provider.ts`, `worker.ts`,
`vectors.ts`, `routes.ts`) and **`apps/cli/src/commands/index-maintenance/`** with the topic still
named `"index"` on the wire and in help. The user-facing verb is unchanged; only the directory moves.
**Orchestrator rules** — it must be ruled before SERVER-042 creates the first file, because renaming
five modules mid-chain touches every downstream issue.

**Open Conflict 8 — what does `POST /api/index/rebuild` return?**
It must return before the work finishes, so it cannot report an outcome.
**Recommendation: return the `IndexStatus` snapshot taken immediately after queueing** — every field
is true at the moment of the call, no new schema is invented, and `corpus index rebuild` has counts
to print in its acknowledgment. **Orchestrator rules in CONTRACT-023.**

**Open Conflict 9 — should a persistently-failing chunk produce a doctor warning?**
Failures are neither drift (the files and rows agree) nor ordinary staleness (they will never drain
on their own). The SERVER-038 report-only surface exists for exactly this shape of finding
(`unindexable.ts:42`).
**Recommendation: yes — a `warnings` entry when `failed > 0`**, never moving `ok` and never changing
the exit code, with `corpus index status` as the detailed surface. It costs one warning kind
(server-side only if the contract's warning list is open; check before implementing) and it is the
difference between an operator noticing and not. **Orchestrator rules in SERVER-046.**

**Escalate to the user, not resolvable here:**
- **Open Conflict 1 in full** — it is a decision about what the product is, and it may require a
  SPEC.md §9.1 amendment. The numbers in C10 are the input.
- If Ollama-only turns out to mean **most zero-config users get `disabled`**, and the user judges
  that a failure of the §9.1 local-first promise rather than an honest degrade.
- If the measured embedding throughput makes a first full index take long enough that
  "asynchronous, never blocking" stops being a satisfying answer for a large corpus — that is a
  product conversation, not a worker bug.

---

## Orchestrator bookkeeping (not an agent's work)

1. **Rule Open Conflicts 3, 5, 6 and 7 before spawning SERVER-042 or CONTRACT-023.** All four change
   schema, table registration or file layout at the very start of the chain; ruling them later means
   redoing work in five modules.
2. **Rule Open Conflicts 2, 4 and 8 before spawning CONTRACT-023.** They determine the contract's
   shape and whether INFRA-012 has a second deliverable.
3. **Escalate Open Conflict 1 to the user before SERVER-043 is spawned**, and certainly before
   INFRA-012. SERVER-043 can proceed against a test double under either ruling, but INFRA-012 cannot
   start at all until it is answered.
4. **Update the two Phase A pinning tests deliberately** — `search.test.ts:446-447` and
   `related.test.ts:245` assert `semanticIndex` is absent (C4). They change under SERVER-045, and the
   change is called out in the commit body, not buried.
5. **`SCHEMA_VERSION = 9` is a one-way door for existing workspaces.** After SERVER-042 commits,
   every workspace on the branch needs `corpus db rebuild` before `corpus db doctor` will run at all
   (C1). Note it in the PR body — it is the kind of thing that reads as a bug to a reviewer.
6. **INFRA-012's status.** Under the recommended rulings for Open Conflicts 1 and 2, it has no
   deliverables. Either mark it `blocked` on the user decision in `issues/PLAN.md` and drop it from
   this sprint, or reduce it to TEST-920/921 and close it — but do not spawn an agent to implement an
   issue whose premises have both been ruled away.
7. **Correct the issue files' vocabulary.** SERVER-045, CONTRACT-023 and CLI-020 all say
   `catching-up` / `lexical-only`, which do not exist (C3). Fix the issue text when each is picked
   up, or the implementing agent will write the enum widening the freeze exists to prevent.
8. **Correct SERVER-042's migration criterion** (C1) and its row-diff criterion (C2) when it is
   picked up.
9. **Correct CLI-020's "exact wording per state" criterion** (C15) — it would undo CLI-019's
   deliberate design.
10. `/audit` qualifies for **SERVER-042** (schema change, cross-cutting, touches the projection every
    other subsystem reads), **SERVER-044** (lifecycle and concurrency — the class of bug that only
    appears in production), and **SERVER-045** (>5 files, changes the shipped ranking of a signed
    endpoint). CONTRACT-023 qualifies as cross-domain by construction.

---

## Merge order (recommendation)

1. **CONTRACT-023 alone, first**, concurrent with nothing that depends on it. It unblocks three
   issues and its artifacts must be regenerated once, early, so downstream agents build against a
   stable client. Rule Open Conflicts 2, 4, 6 and 8 before spawning.
2. **SERVER-042 second**, concurrent with CONTRACT-023 (disjoint workspaces). Rule Open Conflicts 3,
   5 and 7 first. It is the largest risk in the batch: a schema change plus a new chunker plus a
   change to a signed endpoint's address derivation. It gets the closest read and an `/audit`.
3. **SERVER-043 third**, after 042 commits. Small, self-contained, and it ships against a double —
   so it is the one issue in the chain that is not gated on a user decision.
4. **SERVER-044 fourth**, after 043. Concurrency and lifecycle: it gets an `/audit` and its
   kill-restart evidence is read carefully, because TEST-855 and TEST-858 describe failures that a
   green suite will not catch.
5. **SERVER-045 and SERVER-046 concurrently**, after 044 — two agents, this batch's real ceiling.
   They touch different files (`search/` + `docs/related.ts` vs `semantic/routes.ts` +
   `projection/doctor.ts`) and share only the counts SERVER-044 already produced. SERVER-045 gets an
   `/audit`.
6. **CLI-020 after SERVER-046**, alone. Small: a topic, two verbs, a docs regeneration.
7. **INFRA-012 last, or not at all** — see bookkeeping item 6. If it runs, it runs while nothing else
   is building, and it coordinates each `package:build` with the orchestrator.
8. **Harvest** — regenerate both drift-checked artifacts, then the single repo-wide gate.
9. **PR, then babysit** to merge. The PR body carries the `SCHEMA_VERSION` note (bookkeeping 5), the
   Open Conflict rulings, and C10's size table if any packaging decision landed.
10. **Evaluate** with **TEST-930** (Phase A byte-stability), **TEST-932** (the paraphrase pair found
    end to end through the bin) and **TEST-901/931** (`rebuild && doctor` clean while pending) as the
    three headline behavioural checks. They are, respectively, "nothing broke", "the feature works",
    and "the invariant held".

---

## Done Criteria

This sprint is complete when:

- All non-struck acceptance tests PASS in the evaluator's verdict, with every `STRUCK`/`DEFERRED`
  criterion carrying its reason and substitute evidence
- **TEST-930 passes** — a lexical-only workspace's `/api/search` and `/related` responses are
  byte-identical to Phase A's except for the added `semanticIndex: "disabled"`. Phase A's shapes are
  signed and shipped; a Phase B that moves them has failed regardless of how well the semantic half
  works
- **TEST-932 passes** — a keyword-disjoint paraphrase pair is found by `corpus search` and labeled
  `similar` by `corpus doc related`, from the real bin, with the provider named. This is the only
  test that proves the sprint delivered a feature rather than a schema
- **TEST-901 and TEST-931 pass** — `corpus db rebuild && corpus db doctor` is clean, exit 0, with
  `pending > 0`. SPEC.md §14's signed drift-vs-staleness rule is the one thing in this sprint that a
  plausible-looking implementation gets wrong by accident
- **TEST-855, TEST-856, TEST-857 and TEST-858 pass** — kill mid-batch, clean shutdown ordering,
  cancellation across awaits, and survival of `db rebuild`'s rename. These four are the concurrency
  bugs that ship green and surface in a user's workspace three weeks later
- **TEST-867, TEST-868 and TEST-874 pass** — the frozen enums are byte-identical and a
  CONTRACT-022-era value still typechecks against the current types. The freeze was signed precisely
  so Phase B could not do this
- **TEST-845 and TEST-846 pass** — the sticky identity survives a restart, a `db rebuild`, a
  newly-reachable runtime, and a version upgrade, and changes only through a config edit or
  `corpus index rebuild`. §9.1 calls a surprise background rebuild the thing to prevent
- **TEST-825 passes with a pasted row-level diff** — a one-section edit recomputes one section's
  embeddings and leaves the rest bit-identical. "Re-indexing is proportional to the edit" is §9.1's
  observable promise and the reason content addressing exists
- **TEST-836 passes, or is struck with Open Conflict 3's ruling quoted** — the PR #15 finding is
  closed or consciously deferred, never silently carried
- **TEST-920 passes** — INFRA-012's log opens with C10's measured numbers and states which ruling it
  implements. The issue's instruction is to say it loudly; a silent 100× is the failure
- **TEST-937 passes** — no dependency landed in any manifest without a quoted ruling.
  `onnxruntime-node`, `sqlite-vec`, `@huggingface/transformers`, `@xenova/transformers`, `fastembed`
  and `sharp` appear nowhere
- **TEST-940 passes** — `openapi.json` and `docs/cli.md` both regenerate with no diff
- `/test` passes with no regressions and `/lint` passes
- The repo-wide coverage gate passes at harvest at ≥ 90% with **no new exemption** in
  `scripts/coverage-config.ts` (TEST-939)
- `git diff SPEC.md` is empty (TEST-934), and `packages/contract/src/schemas/retrieval.ts` changed
  only in prose (TEST-935)
- `git status` is clean of scratch escape, `/Users/theophanerupin/code/corpus/.corpus` is absent,
  `8765` was never bound or killed, and every port in the table is free at session end (TEST-938)
- Every Open Conflict is either ruled or explicitly carried forward, and all ten orchestrator
  bookkeeping items are cleared

## Orchestrator adjudications (2026-07-31, pre-dispatch)

- **OC1 — USER RULED: local-runtime-or-configured only.** No bundled model, no
  runtime dependency; zero-config without a local runtime reports `disabled` and
  search stays lexical. §9.1 amended (both bullets). INFRA-012 rescoped: its
  deliverable is now the NEGATIVE pack proof — the pack stays ~3 MiB, ships no
  model artifact, no inference runtime, no native vector extension; pack-audit
  rules assert the absence.
- **OC2 accepted**: pure-JS cosine scan is the primary and only v1 vector path
  (3.3ms @ 10k×384 measured); no native extension, no sqlite-vec dependency.
- **OC3–OC9 accepted as recommended**: chunk-granular FTS address table (fixes the
  PR #15 first-occurrence note without moving Phase A ranking); indexing > stale;
  chunk_embeddings preserved across db rebuild via ATTACH-copy; existing DriftKinds
  reused (no contract rider); directories apps/server/src/semantic/ and
  apps/cli/src/commands/index-maintenance/; POST rebuild returns the post-queue
  IndexStatus snapshot; failed>0 yields a report-only doctor warning.
- C15 honored: CLI-020 must NOT introduce per-state wording — CLI-019's generic
  semanticIndexNote stands.
