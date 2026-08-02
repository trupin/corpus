# [INFRA-012] Pack stays lean: prove no model, no runtime, no native extension ships

**RESCOPED 2026-07-31** (sprint-021 OC1 user ruling + OC2): the bundled model and the
native extension are both rejected. This issue is now the negative proof.

## Domain
infra

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SERVER-043, SERVER-045
- Blocks: —

## Spec References
- SPEC.md §9.1 local-first bullet (SHARED-006 Edit 6); §2.2 packaging decisions; user decision: local tool, zero-key, no npm publish (distribution = clone+build+pack)

## Summary
**Rescoped (sprint-021 OC1-REVISED + OC2).** The bundled model and the native vector
extension are both refused, so the deliverable inverts: prove — mechanically, in CI —
that the pack ships *neither*, and record what the refusal costs instead.

1. **The absence, asserted.** `pack-audit.ts` gains rules forbidding model weights,
   model-adjacent sidecars (tokenizer/vocab), populated model caches, native code
   (`.node`/`.dylib`/`.so`/`.dll` — the sqlite-vec class OC2 rejected) and vendored
   `.wasm`, plus a total-byte ceiling that catches an artifact renamed out of every
   named pattern.
2. **The dependency, asserted the other way.** The wasm runtime is a *legitimate*
   dependency of the published package; the generated manifest must carry it, or an
   install has a semantic stack and nothing to run it on. Its size is **recorded**,
   not fought.
3. **The numbers.** Tarball before/after Phase 8 and the installed `node_modules`
   delta, in this log and in `pack-audit.ts`'s own comment.

Superseded, for the record: deliverable 1 was "stage the model in `dist-package/`"
(TEST-922/923) and deliverable 2 was "stage a native vector extension" (TEST-924).
Both are VOID under the rulings; TEST-920/921 and TEST-925–929 are the issue.

## Acceptance Criteria
- [x] `npm run package:build && npm run pack:check` green with the absence rules audited both directions (planted artifacts fail the audit; the clean stage passes)
- [x] Installed-layout smoke: from a packed install, zero-config `index status` reports the identity and the state honestly, with a cold `CORPUS_MODEL_CACHE_DIR`
- [x] No native extension is staged and the pure-JS scan is the only vector path — semantic search answers `current` from the packed install
- [x] Pack size delta recorded as a number; `MAXIMUM_PACKED_BYTES` wired as the regression guard

## Technical Design
### Files to Create/Modify
- `scripts/pack-audit.ts` — the absence rules + `MAXIMUM_PACKED_BYTES`
- `scripts/check-pack.ts` — pass npm's per-file `size` through to the audit
- `scripts/package-manifest.ts` — `assertRequiredRuntimeDependencies`, called by `buildPublishManifest`
- No staging change (`scripts/package-staging.ts` untouched: nothing new is staged — that is the point)
- No CI change: `pack:check` already runs in three workflows (see the log)

## Testing Strategy
Script-level tests where they exist; the pack audit IS the test. No full builds while other heavy tasks run (coordinate with the orchestrator).

## E2E Verification Plan
Pack → install into a scratch prefix → `corpus init` + index a doc fully offline (network disabled for the process).

## E2E Verification Log

**Implemented on: opus** (claude-opus-5, 1M context). Machine: darwin 24.6.0, 8 CPUs.
Ruling implemented: **sprint-021 OC1-REVISED** ("no bundled model … the runtime dep is
now legitimate, size recorded; download path exercised") **+ OC2** (pure-JS cosine
scan is the only vector path). No model artifact, no native extension, and no vendored
runtime is staged; the runtime is an ordinary npm dependency of the published package.

### TEST-920 — the size case, measured before anything was staged

**The tarball** (`find dist-package -type f -print0 | xargs -0 stat -f "%z" | awk …`,
the same command that produced C10's baseline):

| | before Phase 8 (sprint-021 C10) | after Phase 8 (2026-08-01) | delta |
| --- | --- | --- | --- |
| `dist-package/` | **3,084,162 B (2.94 MiB)** | **3,229,917 B (3.08 MiB)** | **+145,755 B, +4.7% (1.047×)** |
| files | 30 | 30 | 0 |

Per subtree (KiB): `ui/` 1344 → 1348, `plugins/` 744 → 780, `server/` 492 → **584**,
`dist/` 392 → 404, `assets/` 84 → 84. Almost the entire increase is the server bundle
carrying the embedding engine's own code (engine, tokenizer, worker host, download,
cache). **Nothing new was staged** — same 30 files.

`npm pack` on the staged package: **30 files, 0.89 MB packed / 3.08 MB unpacked.**

**The dependency footprint** (TEST-927 — the bigger number, by 45×). Two real installs
into scratch prefixes, `du -sk node_modules`:

| | KiB | MiB |
| --- | --- | --- |
| pre-Phase-8 dependency set (the same 9 packages, minus the runtime) | 26,040 | **25.4** |
| after (dependencies only) | 169,580 | **165.6** |
| **delta** | **+143,540** | **+140.2** |
| of which `onnxruntime-web` alone | 135,300 | 132.1 |
| `onnxruntime-web` + its six transitives (`onnxruntime-common`, `protobufjs`, `flatbuffers`, `long`, `platform`, `guid-typescript`) | 140,388 | 137.1 |

SERVER-048 measured the same install as **+137.4 MiB** in the repo tree; the two agree
(the residue here is protobufjs's `@protobufjs/*` helper packages). Recorded, not
fought — it buys a ~3 MiB tool the ability to embed in-process with no model server,
against `onnxruntime-node`'s 258.3 MiB and its downloading `postinstall` (rejected).

Four `.wasm` files ship **inside the runtime's own npm tarball** (13.2 / 26.2 / 14.7 /
23.7 MiB = 77,752 KiB) and **zero** inside ours.

**Install hooks in the installed tree** (walked over every `package.json` under
`node_modules`):

```
better-sqlite3: install = prebuild-install || node-gyp rebuild --release   (pre-existing)
protobufjs:     postinstall = node scripts/postinstall                     (new, via onnxruntime-web)
```

So yes — the package now has a `postinstall` in its dependency tree. It is
`protobufjs`'s, read in full by SERVER-048: it returns immediately when
`pkg.versionScheme` is absent (it is) and otherwise only prints a warning. No network,
no download, no compilation. `onnxruntime-web` itself declares no install hook.

### TEST-925 — `package:build` + `pack:check`, and the rules proven to fire

```
$ npm run package:build
package:build ✓ corpus@0.0.0 staged in dist-package/
  dist/corpus.js      403 kB
  server/main.js       582 kB
  ui/                 5 files
  assets/workspace/   11 files
  plugins/            todos
  dependencies       @hono/node-server, @hono/zod-openapi, better-sqlite3, chokidar,
                     diff-match-patch, hono, onnxruntime-web, openapi-fetch, yaml, zod

$ npm run pack:check
pack:check ✓ corpus@0.0.0 — 30 files, 0.89 MB packed / 3.08 MB unpacked
```

Negative evidence over the staged tree and over the real tarball:

```
$ find dist-package -type f \( -name "*.onnx*" -o -name "*.wasm" -o -name "*.node" \
    -o -name "*.dylib" -o -name "*.so" -o -name "*.so.*" -o -name "*.dll" -o -name "*.gguf" \
    -o -name "*.safetensors" -o -name "*.bin" -o -name "tokenizer*.json" -o -name "vocab.txt" \)
NONE

$ tar tzf corpus-0.0.0.tgz | /usr/bin/grep -E "\.(onnx|wasm|node|dylib|so|dll|gguf|safetensors|bin)$|tokenizer|vocab"
NONE — no model, no runtime binary, no native extension
```

A rule that never fires proves nothing, so each was planted against the **real** stage
and `pack:check` re-run (all four artifacts then removed, audit green again):

```
pack:check ✗ "server/model_quantized.onnx" must not ship — model weights are downloaded once into a per-user cache, never packed (sprint-021 OC1-REVISED; 21.9 MiB int8 against a 3 MiB package) ("**/*.{onnx,onnx_data,gguf,safetensors,bin}")
pack:check ✗ "server/tokenizer.json" must not ship — the tokenizer downloads beside the weights, under the same hash pin (SERVER-048 Decision 2) — one mechanism, and no model-adjacent file in the tarball ("**/{tokenizer,tokenizer_config,special_tokens_map}.json")
pack:check ✗ "server/vec0.dylib" must not ship — the tool ships no native code: OC2 rejected `sqlite-vec` and every native vector extension in favour of the pure-JS cosine scan, and the one native dependency it does have (`better-sqlite3`) is installed by npm, not vendored ("**/*.{node,dylib,dll,a,lib}")
pack:check ✗ "server/ort-wasm-simd-threaded.wasm" must not ship — `onnxruntime-web`'s WebAssembly arrives inside its own npm tarball as a declared dependency (137.4 MiB in `node_modules`, recorded in INFRA-012); a `.wasm` inside *this* tarball means the runtime was vendored ("**/*.wasm")
```

And the extension-independent guard, with a 22,972,370-byte blob named `blob` under
`assets/workspace/` — matched by no named pattern:

```
pack:check ✗ the tarball unpacks to 25.0 MiB, over the 8.0 MiB ceiling — the tool ships
neither an embedding model nor an inference runtime (sprint-021 OC1-REVISED), so
something large was staged that should not have been
```

### The other direction — the manifest must carry the runtime

`onnxruntime-web` is reached through a **dynamic** `await import("onnxruntime-web")`
(`apps/server/src/semantic/engine/runtime.ts:80`), and `externalizeThirdParty` leaves
it external, so it is derived from the esbuild metafile like every other dependency:

```
$ /usr/bin/grep -o 'import("onnxruntime-web")' dist-package/server/main.js
import("onnxruntime-web")
$ /usr/bin/grep -n "onnxruntime\|better-sqlite3" dist-package/package.json
33:    "better-sqlite3": "^12.4.1",
37:    "onnxruntime-web": "^1.27.0",
$ /usr/bin/grep -c "ort-wasm" dist-package/server/main.js
0
```

One reference to the runtime in the whole 596,415-byte server bundle, and it is the
`import()`; the only `InferenceSession` line is our own call site (`main.js:3998`).
Nothing of the runtime is inlined. Because that derivation rests entirely on esbuild
reporting a *dynamic* external, its silent loss would produce a package that builds,
packs, installs, boots and reports `disabled` forever — so
`assertRequiredRuntimeDependencies` now fails the build if `onnxruntime-web` or
`better-sqlite3` ever drops out of the generated manifest.

### TEST-921 / TEST-928 — the packed install, end to end

Real tarball, real install into a scratch prefix (`…/s021-infra/012-pack/install`),
nothing from the repository on the path:

```
$ cd dist-package && npm pack --pack-destination …/tarball
corpus-0.0.0.tgz   (931,692 bytes, 30 files)

$ npm install …/tarball/corpus-0.0.0.tgz
added 70 packages, and audited 71 packages in 3s
found 0 vulnerabilities

$ …/install/node_modules/.bin/corpus --version
0.0.0
```

`corpus init` with an explicit path, and a **cold** `CORPUS_MODEL_CACHE_DIR` pointed at
an empty scratch directory (0 entries at the start):

```
$ corpus init …/012-pack/ws --port 8807
Initialized Corpus workspace at …/012-pack/ws
  port 8807, token in .corpus/config.json (mode 600)
  git: initialized on main, one commit authored as user
  installed 8 template files, recorded in .corpus/template-manifest.json
  installed 1 plugin skill file into .claude/skills/
  installed 1 plugin seed template into data/docs/templates/

$ corpus server start
corpus 0.0.0 listening on http://127.0.0.1:8807 (pid 90973)
```

The server log shows the download path **announced**, never silent (TEST-928):

```
{"level":"info","msg":"semantic index disabled: the all-MiniLM-L6-v2 embedding model (22.6 MiB) has not been downloaded yet; it downloads on the first index run and search is lexical until then"}
{"level":"info","msg":"downloading the all-MiniLM-L6-v2 embedding model (22.6 MiB) into …/model-cache/all-MiniLM-L6-v2@751bff37182d3f1213fa05d7196b954e230abad9 — this happens once per machine"}
{"level":"info","msg":"the all-MiniLM-L6-v2 embedding model is cached in …; semantic indexing can start"}
{"level":"info","msg":"semantic index: embedding with local/all-MiniLM-L6-v2@384 (embedded)"}
```

The download was fast enough (seconds) to run the **full** loop rather than stopping at
`downloading`, so the whole path is proven from the packed install:

```
$ corpus index status
identity    local/all-MiniLM-L6-v2@384
indexed     48
pending     11
failed      0
rebuilding  no
state       stale

$ corpus index status --json        # after the drain
{"indexed":59,"pending":0,"failed":0,"identity":"local/all-MiniLM-L6-v2@384","rebuilding":false,"state":"current"}

$ corpus search "what needs my attention" --json | head -c 120
{"hits":[{"id":"doc_skillcomment",…                       …,"semanticIndex":"current"}
```

Hybrid ranking answered from a packed install with no repository present, and the
embedding worker resolved its entry from the bundle itself (`import.meta.url` =
`server/main.js`) — 59 chunks embedded is that proof.

**The negative proof made visible.** What the tarball does not contain, sitting in the
scratch cache afterwards, hashes equal to `manifest.ts`'s pins byte for byte:

```
all-MiniLM-L6-v2@751bff37182d3f1213fa05d7196b954e230abad9/
  model_quantized.onnx  21.9M   afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1
  tokenizer.json       695.0K   da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0
23,520 KiB total
```

22.6 MiB of model beside a 3.08 MiB tool. Staging it would have made the package
25.7 MiB — **8.3×**; staging the runtime beside it, 157.8 MiB — **51×**. The
dependency delta alone (140.2 MiB) is **45×** the entire tarball.

TEST-921 specifically: **no vector extension is staged and none exists** — `db.loadExtension`
is never called anywhere in the tree, the only vector path is the pure-JS cosine scan
(OC2), and the packed install above reached `state: current` and answered
`semanticIndex: "current"` on it. Before the model existed, the same install answered
`disabled` honestly with a lexical result — never an error, never a lie.

Server stopped, port verified free:

```
$ corpus server stop
stopped (pid 90973)
$ lsof -nP -iTCP:8807 -sTCP:LISTEN
8807 free
```

### TEST-929 — CI already covers it, no new job

`pack:check` is the single entry point for these rules, and three workflows run it —
no workflow file needed to change:

| workflow | job | step |
| --- | --- | --- |
| `.github/workflows/ci.yml` (`CI / validate`) | `validate` | `package build + tarball audit` → `npm run package:build && npm run pack:check` (lines 44–49) |
| `.github/workflows/package.yml` (`Package`) | `tarball` | same step (lines 46–49), and the ordering comment already states a `pack:check` failure stops the job before any artifact or comment |
| `.github/workflows/release.yml` | release | same pair before anything is attached (lines 71–72) |

`scripts/` is outside `COVERAGE_INCLUDE`, so no coverage exemption was added or needed
(sprint-021 TEST-939).

### Checks

```
$ ./node_modules/.bin/tsc --noEmit -p scripts/tsconfig.json      → clean
$ ./node_modules/.bin/eslint scripts/{pack-audit,pack-audit.test,package-manifest,package-manifest.test,check-pack}.ts → clean
$ ./node_modules/.bin/prettier --check …                          → clean
$ VITEST_MAX_THREADS=4 vitest run scripts/pack-audit.test.ts scripts/package-manifest.test.ts
  2 passed, 80 tests
```

Scratch used: `…/jobs/4dd0ddef/tmp/s021-infra/012-pack` (tarball, two installs,
workspace, model cache). Port 8807 only; 8765 never touched. Every pid started
(90973) was stopped.

### Unresolved / carried forward

- **The ceiling is a mechanical guard, not an agreed policy number.** 8 MiB is ~2.6×
  today's 3.08 MiB and far below the 21.9 MiB smallest artifact anyone proposed. If a
  future issue legitimately grows the pack past it, that is a conversation, not a
  silent bump — the number lives in one place with the reasoning attached.
- **No offline-install proof for the dependency.** The tarball is provably
  network-free, but `npm install` of the package pulls 140 MiB, so a genuinely offline
  *install* needs a registry mirror. Out of scope here; SERVER-048 proved the
  *runtime* offline (network sabotaged, warm cache, still embeds).

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
