# [SERVER-048] Embedded embedding engine: in-process model, downloaded once, no model server

## Domain
server

## Status
done

## Priority
P0

## Model
opus

## Dependencies
- Depends on: SERVER-043 (implements its EmbeddedEngine interface)
- Blocks: SERVER-044 (real embeddings), INFRA-012 (pack posture)

## Spec References
- SPEC.md §9.1 local-first bullet (as re-amended 2026-07-31: in-process embedding, per-user model cache, no model-server software)

## Summary
User ruling (2026-07-31): no Ollama or any model-server equivalent — such software can
pull arbitrary third-party models online and is frequently unapprovable in corporate
environments; a bare model file run in-process is inert data. Build the embedded
engine behind SERVER-043's `EmbeddedEngine` interface:

- **Runtime**: an in-process inference library chosen with a SIZE BUDGET — prefer the
  smallest viable option (a wasm backend is acceptable; at corpus scale, background
  embedding of ~2k-char chunks tolerates tens of ms each). Record the measured
  node_modules delta; sprint-021 measured onnxruntime-node at ~258 MiB unpacked —
  treat that as the ceiling to beat, not the default. No native postinstall scripts
  if avoidable; whatever is chosen must be a plain npm dependency (no runtime
  downloads of executable code — only the MODEL artifact downloads).
- **Model**: a small permissively-licensed embedding model (MiniLM-class; sprint
  measured int8 ONNX at ~22 MiB). Downloaded ONCE into a per-user cache directory
  (shared across workspaces; document the path), verified against a PINNED
  content hash (a tampered or truncated download is discarded and reported —
  never loaded), over HTTPS from a fixed URL. Downloads happen lazily on first
  index need, with progress visible in index status; no download at install time,
  none at server boot.
- **Offline honesty**: model absent + no network → `disabled` with a status message
  saying the model is not yet downloaded; the download retries on later index
  attempts, never in a hot loop.
- Identity string: engine + model + revision (drives §9.1 stickiness).

## Acceptance Criteria
- [x] Zero-config on a machine with the model cached: embeddings compute in-process, no network syscalls during embed (prove with a network-disabled run)
- [x] First run without the cache: model downloads with progress surfaced in index status, hash-verified; corrupted download discarded + reported, never loaded — *hash verification was met at the time; the progress half was **not**, and was fixed on 2026-08-01 (see "AC 2, second half" below)*
- [x] No model-server, no daemon, no exec of downloaded code — the artifact is data loaded by the in-process library (state the proof)
- [x] node_modules delta recorded; wasm-vs-native choice justified with measurements at corpus scale (embed throughput for ~10k chunks)
- [x] Engine reports availability()/identity per SERVER-043's interface; SERVER-044 consumes it unchanged

## Technical Design
### Files to Create/Modify
- `apps/server/src/semantic/engine/` (+ tests, download module with injected fetch, hash pin); apps/server/package.json (the chosen runtime dep)

## Testing Strategy
apps/server scoped (VITEST_MAX_THREADS=4); download module fully stub-tested; one gated real-download integration test (skipped when offline).

## E2E Verification Plan
Real server, empty cache: first index triggers the download (progress in status) → embeddings flow; kill network → still embeds (cache hit); corrupt the cached file → discarded + re-reported.

## E2E Verification Log

**Implemented on: opus** (Opus 5, 1M context). Date 2026-07-31. Machine: darwin arm64,
8 logical CPUs (4 performance), Node 25.2.1. Ports used: **8805** only (8804 unused, 8765
never bound — verified free at session end).

---

### Decision 1 — runtime library, chosen under the size budget

Measured into isolated scratch packages (`--prefix` outside the repo), `du -sk node_modules`
after a real install, plus `npm view <pkg> dist.unpackedSize`:

| candidate | real `node_modules` | install hooks | native code | verdict |
| --- | --- | --- | --- | --- |
| `@huggingface/transformers@4.2.0` | **393 MiB** (`onnxruntime-node` 213 MiB + `onnxruntime-web` 131 MiB + `@img`/sharp 16 MiB) | yes, transitively | yes | rejected |
| `onnxruntime-node@1.27.0` | ~258 MiB (registry `unpackedSize` 270,827,297 B) | **`postinstall: node ./script/install`** | prebuilt `.node` | rejected — the sprint's ceiling, and its postinstall *fetches execution-provider binaries*, i.e. downloads executable code at install |
| `@wllama/wllama@3.5.1` | 17.9 MiB (registry) | none | wasm | rejected — browser-targeted (Worker/Cache APIs), no supported Node path |
| `fastembed@2.1.0` | 0.1 MiB + `onnxruntime-node` | — | yes | rejected — drags the native runtime and downloads models itself |
| `sqlite-vec`, `sherpa-onnx`, `@qvac/onnx`, `tfjs-onnx`, `onnxjs` | — | — | — | rejected — not general ONNX inference under Node, or unmaintained |
| **`onnxruntime-web@1.27.0`** | **137.4 MiB** | **none** | **none — WebAssembly** | **chosen** |

Real delta, measured in this repo (`du -sk node_modules` before/after `npm install`):
**233,304 KiB → 374,008 KiB = +140,704 KiB (+137.4 MiB)**. None of its six transitive deps
(`onnxruntime-common`, `protobufjs`, `flatbuffers`, `long`, `platform`, `guid-typescript`)
were already present, so that is the whole cost, not a partial one.

**Install-script audit of the resulting tree** (`scripts` of every added package):
`onnxruntime-web` declares only `prepare`/`prepack`, which npm runs for git/link installs
and never for a registry tarball; it has no `binary` field and no node-gyp step. The single
hook that does run is `protobufjs`'s `postinstall`, which is
`node_modules/protobufjs/scripts/postinstall.js` — read in full: it returns immediately when
`pkg.versionScheme` is absent (it is, in 7.6.5) and otherwise only prints a version-mismatch
warning to stderr. **No network, no download, no compilation, at install or ever.**

Older/smaller versions were measured and passed over: `onnxruntime-web@1.22.0` is 94 MiB and
`@1.14.0` is 68 MiB, but they are 1–3 years behind on a component that parses model files;
40 MiB does not buy that. The size lives almost entirely in artifacts a Node process never
loads — of the 131 MiB in `dist/`, the wasm backend needs `ort-wasm-simd-threaded.wasm`
(12.9 MiB) and one JS bundle; the rest is the WebGPU/JSEP/asyncify/JSPI wasm variants, the
webgl bundles, and source maps. There is no slim distribution of it on npm.

**Throughput, measured through the shipped engine** (`createEmbeddedEngine` → `open()` →
`provider.embed`, real int8 model, 100 chunks of 2,000 characters — each truncating to the
full 256-wordpiece window, i.e. the worst case):

```
cpus=8 threads=4 model load: 325ms
batch= 1: 100 x 2k-char chunks in 4562ms (45.6 ms/chunk)
batch= 8: 100 x 2k-char chunks in 4355ms (43.5 ms/chunk)
batch=32: 100 x 2k-char chunks in 4410ms (44.1 ms/chunk)
rss after: 682 MiB
```

Thread scaling (same benchmark, `onnxruntime-web` wasm): 1 → 155.7 ms/chunk, 2 → 80.7,
**4 → 45.6**, 8 → 78.4 (oversubscription on an 8-thread/4-performance-core machine). Hence
`embeddingThreadCount = min(4, floor(cpus/2))`. The native runtime on the identical model and
inputs did 9.8 ms/chunk, so wasm costs **4.6×** — inside the issue's "tens of ms per chunk is
acceptable" bar for background work that never blocks a write. Extrapolated to the sprint's
corpus scale: **10,000 chunks ≈ 7.6 minutes of background indexing** on four threads
(one-off; incremental re-indexing touches only changed chunks, sprint-021 C2).

### Decision 2 — model, cache, hashes

**Model: `Xenova/all-MiniLM-L6-v2`, int8-quantized ONNX, Apache-2.0, 384 dimensions.**
Everything is pinned in `apps/server/src/semantic/engine/manifest.ts`:

| artifact | bytes | sha256 |
| --- | --- | --- |
| `onnx/model_quantized.onnx` | 22,972,370 | `afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1` |
| `tokenizer.json` | 711,661 | `da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0` |

URLs resolve against the **commit revision** `751bff37182d3f1213fa05d7196b954e230abad9`, not
`main` — verified byte-identical to `main` at pin time, so the URL is immutable *and* the
hash is a second, independent guarantee. Alternatives weighed: fp32 MiniLM (86.2 MiB, 3.9×
for no observable benefit — vectors are only ever compared with vectors from the same model),
`bge-small-en-v1.5` / `gte-small` (32.4 MiB each, same 384 dims).

**Tokenizer decision: downloaded beside the weights, not shipped in the package.** Reasons:
(a) it keeps `dist-package/` byte-identical to today, so INFRA-012's negative pack proof stays
trivially true — *no* model-adjacent artifact in the tarball at all, rather than "one small
one"; (b) it is one mechanism instead of two — same cache, same hash pin, same discard-and-retry
path; (c) the tokenizer must match the model revision, and pinning both in one manifest makes
disagreement impossible. 695 KiB in a 2.94 MiB package would also have been a 23% increase.

**Cache directory: per-user, shared across workspaces, derived from the environment the
server was given** (`cache.ts`) — `CORPUS_MODEL_CACHE_DIR` overrides everything (must be
absolute); otherwise `~/Library/Caches/corpus/models` (darwin),
`%LOCALAPPDATA%\corpus\Cache\models` → `%USERPROFILE%\AppData\Local\...` (win32),
`$XDG_CACHE_HOME/corpus/models` → `~/.cache/corpus/models` (everything else). Leaf directory is
`<model>@<revision>`, so a manifest bump lands beside the old artifact instead of on top of it.
Path arithmetic uses `path.win32` / `path.posix` by the *named* platform, so the Windows
layout is decided rather than inherited. Reading the location from the injected `env` rather
than `os.homedir()` is load-bearing: a server booted with `env: {}` (which is how this
package's own tests boot one) has nowhere to cache and says so, instead of reaching into a
developer's real cache.

**No tokenizer library.** BERT WordPiece is implemented in `tokenizer.ts` (~120 lines) rather
than pulled in, because every JS implementation that reads `tokenizer.json` is either a native
addon or inside `@huggingface/transformers` (393 MiB). It is not written from memory: it
reproduces `@huggingface/transformers@4.2.0`'s `AutoTokenizer` ids **exactly on ten adversarial
inputs** (accents, CJK, punctuation runs, whitespace storms, emoji, an over-long word, rare
subword-heavy vocabulary), and the resulting embeddings match that library's to **1e-8** when
run on the same runtime. Those ids are pinned in `tokenizer.test.ts` against a 114-entry slice
of the real vocabulary (trimming is sound: greedy longest-match over a subset can only fail to
find a longer piece, and every piece the full run matched is present).

---

### E2E leg A — cold cache: lazy download, visible progress, hash-verified

Real `fetch`, real HTTPS, real HuggingFace, cache dir empty at the start
(`.../048-e2e/cache`, 0 entries), driving the shipped `semantic/engine` module:

```
before: {"available":false,"reason":"model-not-downloaded","detail":"the all-MiniLM-L6-v2 embedding model (22.6 MiB) has not been downloaded yet; it downloads on the first index run and search is lexical until then"}
[info] downloading the all-MiniLM-L6-v2 embedding model (22.6 MiB) into .../cache/all-MiniLM-L6-v2@751bff37182d3f1213fa05d7196b954e230abad9 — this happens once per machine
  +608ms  downloading the all-MiniLM-L6-v2 embedding model (0.5 MiB of 22.6 MiB, 2%) — semantic ranking starts once it is cached
  +2065ms downloading the all-MiniLM-L6-v2 embedding model (2.1 MiB of 22.6 MiB, 9%) …
  +2427ms downloading the all-MiniLM-L6-v2 embedding model (7.3 MiB of 22.6 MiB, 32%) …
  +2785ms downloading the all-MiniLM-L6-v2 embedding model (16.3 MiB of 22.6 MiB, 71%) …
  +3030ms downloading the all-MiniLM-L6-v2 embedding model (19.9 MiB of 22.6 MiB, 88%) …
[info] the all-MiniLM-L6-v2 embedding model is cached in …; semantic indexing can start
after: {"available":true} in 3129ms
```

Cache afterwards — both digests equal the pins byte for byte:

```
da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0  …/tokenizer.json
afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1  …/model_quantized.onnx
23M	…/cache
```

Progress is surfaced through `availability().detail`, which is what `corpus index status`
will render (the endpoint itself is SERVER-046's).

### E2E leg B — warm cache, network sabotaged: still embeds

A real Node process in which `globalThis.fetch`, `net.Socket.prototype.connect`,
`net.connect`, `net.createConnection`, `tls.connect`, `dns.lookup`, `dns.promises.lookup`,
`http.request` and `https.request` all throw before the engine is imported — i.e. **every
outbound path Node has**:

```
availability: {"available":true}
embedded 3 texts in 42ms with the network sabotaged
identity: local/all-MiniLM-L6-v2@384 dim: 384
cos(cat,kitten) = 0.6394  cos(cat,postgres) = -0.0119  |cat| = 1.000000
first8: 0.12880,-0.02078,-0.02509,0.03412,-0.03014,0.04272,0.04080,0.03182
```

Those three numbers are `@huggingface/transformers`' own output on the same checkpoint
(`0.6394`, `-0.0119`, and the identical first eight components) — the embeddings are not
merely produced, they are *right*.

**On a real server** (port 8805, workspace created by `corpus init`, warm cache):

```
{"level":"info","msg":"listening on http://127.0.0.1:8805",…}
{"level":"info","msg":"semantic index: local/all-MiniLM-L6-v2@384 (embedded)"}
```

That line is a real in-process forward pass inside the server — SERVER-043's resolution probe
embeds a word and reads `384` off the response. Sockets held by that process, during and after
serving a request:

```
$ lsof -nP -a -p 45785 -i
COMMAND   PID  USER   FD   TYPE  DEVICE  NODE NAME
node    45785  …      25u  IPv4  …       TCP 127.0.0.1:8805 (LISTEN)
$ lsof -nP -a -p 45785 -i -sTCP:ESTABLISHED
  NONE
```

One listening socket, zero outbound connections. `GET /api/health` answered 200 in between;
shutdown was clean (`shutdown complete`, port free).

### E2E leg C — corruption: discarded, reported, never loaded

Both corruption classes, against the real cache:

- **Truncated** (1,000,000 of 22,972,370 bytes): `availability()` reports
  `model-not-downloaded` with *"the cached … model is damaged and will be downloaded again"*
  — the size check catches it without hashing. `open()` refuses:
  `model_quantized.onnx in the model cache is not the pinned artifact (1000000 bytes, sha256 b77cfe20… ; expected 22972370 bytes, sha256 afdb6f1a…) — it has been discarded and will be downloaded again`.
- **Same-size tamper** (one byte flipped at offset 9,000,000, size unchanged):
  `availability()` says `available: true` (the cheap check cannot see it), and `open()` then
  refuses on the digest before any byte reaches the runtime. On a **real server**:

```
{"level":"error","msg":"semantic index unavailable: the embedded engine reported itself available and then failed: the embedded model could not be loaded: model_quantized.onnx in the model cache is not the pinned artifact (22972370 bytes, sha256 b66ec311…; expected …afdb6f1a…) — it has been discarded and will be downloaded again"}
files left in the model dir: tokenizer.json
```

The damaged file is gone (so the next index run re-downloads rather than failing forever), the
tokenizer is kept, and `onnxruntime-web` was never called. Restoring the artifact and rebooting
returns to `semantic index: local/all-MiniLM-L6-v2@384 (embedded)`.

### E2E leg D — nothing downloads at boot

Real server, `CORPUS_MODEL_CACHE_DIR` pointed at an empty directory:

```
{"level":"info","msg":"semantic index disabled: the all-MiniLM-L6-v2 embedding model (22.6 MiB) has not been downloaded yet; it downloads on the first index run and search is lexical until then"}
files created under the cold cache: 0
```

The server boots, serves, and reports the honest reason §9.1 asks for — *"not downloaded yet"*
is a different sentence from *"nothing configured"* — and fetches nothing. Pinned in
`lifecycle.test.ts` by a test that replaces `globalThis.fetch` with a recorder for the whole
boot and asserts zero calls and no directory created. The lazy trigger is
`engine.requestModel()`; its caller is SERVER-044's worker (there is no index verb yet to call
it from, which is why leg A drives the engine module directly rather than through a route).

### The no-exec proof

Nothing downloaded is executable, and the argument does not rest on trust:

1. **Two data files, no code.** The artifacts are an ONNX graph (protobuf) and a JSON
   vocabulary. Neither is JavaScript, neither is a native module, neither is a plugin.
2. **Parsed by a dependency that was already in the lockfile.** The graph goes to
   `onnxruntime-web`, resolved from `node_modules` at the version `package-lock.json` pins;
   the tokenizer goes to `zod` through `TokenizerFileSchema`. No `eval`, no `new Function`, no
   `import()` of anything downloaded, no `dlopen`, no `process.dlopen`, no
   `loadExtension` — `/usr/bin/grep -rn` over `apps/server/src/semantic/engine/` for
   `eval|new Function|dlopen|require(|child_process|createRequire|vm\.` returns nothing.
   The one dynamic import in the directory is the literal `import("onnxruntime-web")`.
3. **The runtime executes wasm inside V8's sandbox**, not machine code the process links.
   `onnxruntime-web` ships `.wasm` files *inside its npm tarball* — they arrive with the
   dependency, hashed by the lockfile's integrity field, not at runtime.
4. **Hash-pinned, and verified at the last possible moment.** `readVerifiedArtifact` reads the
   bytes, hashes them, and hands *those same bytes in memory* to
   `InferenceSession.create(weights)` — a path, which could change between check and open, is
   never given to the runtime. A mismatch deletes the file and throws before any parse.
5. **No daemon, no server, no port.** The engine is a function in the server process. Nothing
   listens, nothing is spawned, nothing is installed. `lsof` above shows the process holding
   exactly one socket: its own.
6. **No install-time or boot-time network at all** (legs D and the install-script audit above).

### AC 2, second half — progress in `index status` (fixed 2026-08-01)

Implemented on: opus (Opus 5, 1M context).

The SERVER-048 evaluation refuted this criterion (FAIL-1): `availability().detail` carried the
percentage, but nothing carried it to the wire — `IndexStatus` was six fields and none of them
was a reason. Its LEDGER-1 added the other half: after the download *and* the drain finished, a
first run still reported `disabled` for the remainder of the 30 s resolution cooldown. Fixed
across three layers, under an orchestrator-granted contract rider (additive, 2026-08-01):

- **Contract** — `IndexStatus` gains one **optional** `detail?: string`
  (`packages/contract/src/schemas/index-maintenance.ts`). The four-value state enum did not
  move. A-compat is asserted, not reviewed: `index-maintenance.compat.test.ts` transcribes the
  pre-rider component by hand and pins assignability in both directions plus the field's
  optionality on the generated type. Artifacts regenerated; drift check clean.
- **Server** — `SemanticRetrieval.status()` publishes the word and the sentence from **one**
  reading of the facts, so a workspace cannot report `current` beside "downloading … 98%".
  While the cached resolution says `model-not-downloaded` — the only unavailability that
  expires by itself — a status read re-asks `engine.availability()` (two `stat`s, no network,
  no model load), which is where the live percentage lives. Finding the model *present* there
  ends the cooldown; and the engine's new `onModelReady` push (wired in `lifecycle.ts`) ends it
  for the search path too, without waiting for anybody to poll. The cooldown itself is
  unchanged for the cases it exists for — an unreachable configured endpoint still costs one
  timeout per cooldown.
- **CLI** — one unlabelled line under the block when the server sends a `detail`; the six
  labelled positions never move, and it is silently absent otherwise.

**Measured, on a real server, cold `CORPUS_MODEL_CACHE_DIR`, 60 chunks, 250 ms sampling.**
"Before" is the same build with the three new behaviours switched off at their seams
(`CORPUS_RIDER_OFF=1`, a temporary flag removed afterwards; no `CORPUS_RIDER_OFF` remains in
the tree). Times are relative to the sampler's first request.

| | before (port 8804) | after (port 8805) |
| --- | --- | --- |
| samples during the download | `state: disabled`, no detail, byte-identical | `3%` → `4%` → `15%` → `63%`, moving |
| download completed | 3.11 s | 13.47 s |
| index complete (`indexed == total`, identity recorded) | 9.24 s | 20.23 s |
| first `state: current` | **never within the 30.6 s observation** (confirmed `current` only after the cooldown) | **20.23 s — the same sample** |
| blind window after the index completed | **≥ 21.3 s** (bounded by `RESOLVE_COOLDOWN_MS`) | **0.00 s** |

The after-run's transitions, verbatim from the sampler (`--json` payloads, unedited):

```
11.44s  cache= 0.0MiB  …"state":"disabled","detail":"the all-MiniLM-L6-v2 embedding model (22.6 MiB) has not been downloaded yet; …"
11.96s  cache= 0.7MiB  …"state":"disabled","detail":"downloading … (0.7 MiB of 22.6 MiB, 3%) — semantic ranking starts once it is cached"
12.96s  cache= 3.5MiB  …"state":"disabled","detail":"downloading … (3.5 MiB of 22.6 MiB, 15%) …"
13.22s  cache=14.4MiB  …"state":"disabled","detail":"downloading … (14.4 MiB of 22.6 MiB, 63%) …"
13.47s  cache=22.6MiB  …"state":"disabled","detail":"local/all-MiniLM-L6-v2@384 is ready; the index has no vectors yet, …"
17.44s  indexed 16/60  …"state":"stale"                     ← draining, honestly, not `disabled`
20.23s  indexed 60/60  …"state":"current"                   ← same sample as pending → 0
```

Line 5 is the fix's load-bearing moment: the cache reached 22.6 MiB and the *same* 250 ms
sample already reports a resolved model, with no cooldown wait anywhere.

`corpus index status` during the same download, real CLI against the real server (the renders
the evaluator asked for, `--- <epoch ms>` headers elided):

```
identity    none recorded yet          identity    none recorded yet
indexed     0                          indexed     0
pending     60                         pending     60
failed      0                          failed      0
rebuilding  no                         rebuilding  no
state       disabled                   state       disabled
downloading … (0.7 MiB of 22.6 MiB, 3%) — …    downloading … (21.4 MiB of 22.6 MiB, 94%) — …
```

Distinct sentences that reached a terminal across the run: 3%, 10%, 49%, 94%, then
`local/all-MiniLM-L6-v2@384 is ready; the index has no vectors yet, so ranking is lexical until
the first ones land`. Caught up, the render is exactly six lines again and `--json` is
byte-identical to the pre-rider payload:

```
$ corpus index status --json
{"indexed":60,"pending":0,"failed":0,"identity":"local/all-MiniLM-L6-v2@384","rebuilding":false,"state":"current"}
```

The third detail class, on a real server with a configured endpoint nothing is listening on —
including on the second render, i.e. from inside the cooldown, where the pre-fix code would
have had nothing to say:

```
state       disabled
ollama endpoint http://127.0.0.1:19999/api/embed is unreachable: fetch failed
```

Ports 8804/8805 released at the end (`lsof` silent); 8765 never touched.

### Checks

- `npm run typecheck -w apps/server` — clean.
- `npx eslint apps/server/src` — clean, no suppressions added.
- `npx prettier --check "apps/server/src/**/*.ts"` — clean.
- `VITEST_MAX_THREADS=4 vitest run apps/server` — **149 files, 2,864 tests, all passing**
  (2,864 with the model cached; 2 of them are the gated real-model integration tests, which
  skip when it is not).
- Coverage of the new directory (`apps/server/src/semantic/engine/**`): **100% statements,
  100% functions, 100% lines, 94.34% branches** — no exemption added to
  `scripts/coverage-config.ts`.
- `npm run build` — clean.
- Ports 8804/8805 free at session end; 8765 never bound; no stray processes.

### PR #17 review — CRITICAL fix (prototype pollution in the vocabulary lookup)

**Implemented on: opus** (Opus 5, 1M context). Date 2026-08-01. Ports **8804** only
(8805 checked free, 8765 never bound).

**The defect.** `createTokenizer` kept the Zod-parsed `vocab` as a plain object, so
`vocab[piece]` reached `Object.prototype`. Confirmed against the **shipped** artifact
(`~/Library/Caches/corpus/models/all-MiniLM-L6-v2@751bff…/tokenizer.json`): none of
`constructor`, `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`,
`propertyIsEnumerable`, `toLocaleString`, `__proto__` is an own key, and every one of
them resolves to a function (or `object` for `__proto__`). Greedy longest-match-first
starts at the whole word and shortens, so **any word starting with one of those names**
matched. The consequence, run on the same real vocabulary:

```
BigInt(vocab["constructor"])
  → SyntaxError: Cannot convert function Object() { [native code] } to a BigInt
```

which is exactly `inference.ts:102`. Chunk-side that fails the chunk permanently;
query-side it throws inside `embedQuery`, which calls `forget()` and drops the provider
for the whole 30 s cooldown.

**The fix.** `apps/server/src/semantic/engine/tokenizer.ts` builds the vocabulary as a
`Map<string, number>` from `Object.entries(model.vocab)`. A `Map` has no inherited keys
and types a miss as `undefined`, which is the answer the greedy walk was already written
against, so the walk itself is unchanged.

**Tests (all new, all verified failing against the pre-fix lookup by a temporary revert):**

- `tokenizer.test.ts` — `it.each` over nine `Object.prototype` names × four surface forms
  (bare, in a sentence, suffixed, upper-cased): every id is a `number`, and
  `ids.map(BigInt)` — the exact call `inference.ts` makes — does not throw.
- `tokenizer.test.ts` — `encode("the constructor pattern")` is `[101, 1996, 100, 100, 102]`
  (`[UNK]`, not a function). Pre-fix this produced `[101, 1996, [Function Object], 100, 102]`.
- `tokenizer.test.ts` — a vocabulary that legitimately *contains* `constructor` (own and
  `##`-prefixed) still resolves it, so the fix removes a hazard rather than a capability.
- `inference.test.ts` — the whole consequence path: a real tokenizer plus a stub session
  embeds `"the constructor pattern in this corpus doc"` and
  `"toString valueOf hasOwnProperty __proto__"` without throwing.

**Live leg (real server, real model, real workspace `/tmp/corpus-pr17`, port 8804).**
Workspace created with `corpus init`; a note whose body repeats `constructor` and every
other prototype name; second unrelated note.

- `corpus index status --json` →
  `{"indexed":62,"pending":0,"failed":0,"identity":"local/all-MiniLM-L6-v2@384","rebuilding":false,"state":"current"}`
  — **0 failed**, i.e. the chunk holding those words embedded. Pre-fix it could not.
- Query sequence proving the provider is *not* dropped, all within one cooldown window:
  - A `q=how services are built` → `semanticIndex: current`, 6 hits.
  - B `q=constructor` → `semanticIndex: current`, hits
    `['Constructor pattern notes', 'Note template', 'Orchestrate']`.
  - C `q=how services are built` again, immediately → `semanticIndex: current`, same 6 hits.
    A dropped provider would have answered `disabled` here for 30 s.
  - D `q=toString valueOf hasOwnProperty isPrototypeOf` → `semanticIndex: current`, 2 hits.
- `corpus server logs` — no embedding error of any kind; index still `current`, 0 failed.

### PR #17 CI — engine.test.ts failed deterministically on the Node 22 runners

**Implemented on: opus** (Opus 5, 1M context). Date 2026-08-01. Test-only change; no
`engine.ts` behaviour touched, and no product bug found while there.

**Root cause: two synchronisation heuristics that count event-loop turns instead of
waiting on the observable.** `flush()` awaited eight `setImmediate`s; `waitFor()` awaited up
to five hundred. Every fact those waits were for is produced by *filesystem* work — a `stat`
per artifact, a read plus a sha256, a `mkdir` — which completes on libuv's threadpool and is
signalled in the poll phase, while a `setImmediate` loop spins the check phase without
yielding to it. On a fast idle laptop the turns outlast the I/O; on a loaded runner they do
not. Nothing about the engine differs between Node 22 and 25 — the budget was the variable,
and both CI failures were reproduced here by shrinking it:

- `flush` 8 → 1 reproduced failure (1) verbatim: *"is single-flight: a second request while
  one is running starts nothing" — expected [] to deeply equal [ Array(1) ]*.
- `waitFor` 500 → 2 reproduced failure (2), *"releases a session that finished loading during
  shutdown" — condition never held*, **and** a third test of the same class that CI had not
  reached yet, *"surfaces progress through the availability detail while downloading"*.

**Fix.** Both helpers are gone. `until(assertion)` wraps `vi.waitFor` with an explicit
`{ timeout: 5_000, interval: 5 }`, so the budget is wall-clock — the same currency the work
is denominated in — and the polling interval yields to the poll phase. Every wait now names
the fact it is waiting for:

| test | waited on before | waits on now |
| --- | --- | --- |
| makes no request while merely being asked whether it is available | `flush()` | `engine.whenSettled()` |
| is single-flight | `flush()` ×2 | `until(calls === [tokenizer])`, then release + `whenSettled()` + `close()` and an **exact** total call list |
| does nothing when the artifacts are already cached | `flush()` | `engine.whenSettled()` (the attempt that would have downloaded) |
| refuses to retry inside the cooldown | `flush()` | `engine.whenSettled()` |
| never downloads when there is nowhere to cache | `flush()` | `engine.whenSettled()` |
| never downloads where WebAssembly cannot run | `flush()` | `engine.whenSettled()` |
| does not start a download after close | `flush()` | `engine.whenSettled()` |
| waits for an in-flight download during close | `flush()` | `until(calls === [tokenizer])` — the download is now *provably* in flight when `close()` is called |
| surfaces progress while downloading | `waitFor` (500 turns) | `until(availability detail matches /downloading .*%/)` |
| releases a session that finished loading during shutdown | `waitFor(() => entered)` | `until(entered === true)` |
| closes a host that finished loading during shutdown | `waitFor(() => entered)` | `until(entered === true)` |

Two structural improvements came with it. The single-flight negative no longer needs a
window at all: each flight records its URL on entry to `fetchFn` before it can await
anything, so releasing the gate, awaiting `whenSettled()` **and** `close()` (which awaits
whatever is still running) and then asserting the *exact* total `[tokenizer, weights]` proves
that no second flight ever started — strictly stronger than the old "nothing yet after N
turns". And the five hand-rolled `let release; const gate = new Promise(...)` blocks are now
one `gate()` helper whose releases are registered and fired in `afterEach`, so a *failing*
test can no longer leave a `fetch` pending forever and hand the next test a process still
doing the previous one's work.

**Verification.** `engine.test.ts` 40/40 green, run **10×** in a loop on **Node v25.2.1**
(10 pass / 0 fail), plus **5×** more under deliberate 4-way CPU contention (5 pass / 0 fail)
— the closest local approximation of the loaded-runner condition, since the failure is
load-induced. `npm test -w apps/server`: **163 files / 3130 tests** green. `tsc --noEmit`,
`eslint` and `prettier` clean on the file.

**Node 22 was not testable locally**: this machine has only `/opt/homebrew/bin/node` at
v25.2.1, with no `nvm`, `n`, `fnm`, `volta`, `asdf` or `node@22` formula installed (checked
read-only). The argument for CI rests on the reproduction above — the failures were induced
and cured *on Node 25* by changing only the wait budget — plus the fact that the remaining
budget is 5 s of wall clock against facts that currently arrive in about a millisecond.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
