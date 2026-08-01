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
- [x] First run without the cache: model downloads with progress surfaced in index status, hash-verified; corrupted download discarded + reported, never loaded
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

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
