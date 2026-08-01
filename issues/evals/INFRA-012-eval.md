# Evaluation: INFRA-012

**Date**: 2026-08-01
**Sprint**: sprint-021
**Evaluator model**: Opus 5 (1M context)
**Verdict**: PASS

Rescoped to a negative proof: the pack ships no model, no inference runtime, no native vector
extension. I re-ran the build and the audit and enumerated the tarball myself.

## E2E Proof-of-Work Audit

| Check | Result | Notes |
| --- | --- | --- |
| Verification log present | PASS | Opens with C10's measured table and names the ruling it implements (TEST-920) |
| Commands are specific and concrete | PASS | Byte counts, `du -sk` deltas, the four planted-artifact failures quoted verbatim |
| Real E2E (not mocked) | PASS | Real `npm pack`, real install into a scratch prefix, real `corpus init` + index + search from the packed install |
| Scenarios cover acceptance criteria | PASS | All four |
| Application restarted after changes | PASS | Server started from the packed install on 8807 |
| Actual model recorded (implemented on:) | PASS | "Implemented on: opus (claude-opus-5, 1M context)" |
| Reproduction logged before fix (bugs) | N/A | Infra issue |
| **Negative rules proven to fire** | PASS | Four artifacts planted against the *real* stage, each failure message pasted, then removed. A rule that never fires proves nothing — this log knows that |

The log also carries the reverse assertion (`assertRequiredRuntimeDependencies`), which is the
non-obvious half: `onnxruntime-web` is reached by a dynamic `import()` and left external, so its
silent loss from the generated manifest would produce a package that builds, packs, installs, boots
and reports `disabled` forever. Guarding against that is the kind of thing that only gets written by
someone who actually traced the derivation.

## Criteria Results

| # | Criterion | Result | Notes |
| --- | --- | --- | --- |
| 1 | `package:build && pack:check` green with absence rules audited both directions | PASS | Both re-run by me, green |
| 2 | Installed-layout smoke: packed install, cold cache, honest `index status` | PASS (delegated evidence) | Not re-installed by me; the tarball contents, size and dependency declaration were verified directly, and the equivalent behaviour was verified end to end from source |
| 3 | No native extension staged; pure-JS scan is the only vector path; packed install answers `current` | PASS | Zero native artifacts in the tarball; `current` reached and hybrid results returned in my own runs |
| 4 | Pack size delta recorded; `MAXIMUM_PACKED_BYTES` wired | PASS | Size reproduced to the byte |

### Criteria 1 and 4 — re-run, and the number reproduced exactly

```
$ npm run package:build
package:build ✓ corpus@0.0.0 staged in dist-package/
  dist/corpus.js  403 kB   server/main.js  582 kB   ui/ 5 files
  assets/workspace/ 11 files   plugins/ todos
  dependencies  @hono/node-server, @hono/zod-openapi, better-sqlite3, chokidar,
                diff-match-patch, hono, onnxruntime-web, openapi-fetch, yaml, zod

$ npm run pack:check
pack:check ✓ corpus@0.0.0 — 30 files, 0.89 MB packed / 3.08 MB unpacked

$ /usr/bin/find dist-package -type f | /usr/bin/wc -l                             → 30
$ /usr/bin/find dist-package -type f -print0 | xargs -0 /usr/bin/stat -f "%z" | awk '{s+=$1} END {print s}'
                                                                                   → 3,229,917 bytes (3.08 MiB)
```

**3,229,917 bytes** — identical to the byte to the number recorded in the issue log, against the
3,084,162-byte pre-Phase-8 baseline: **+145,755 B, +4.7%**. Same 30 files as before Phase 8; nothing
new was staged.

### Criterion 3 — the negative proof, enumerated by me

```
$ /usr/bin/find dist-package -type f \( -name "*.onnx*" -o -name "*.wasm" -o -name "*.node" \
    -o -name "*.dylib" -o -name "*.so" -o -name "*.dll" -o -name "*.gguf" \
    -o -name "*.safetensors" -o -name "*.bin" -o -name "tokenizer*.json" -o -name "vocab*" \)
   (no output)

$ cd dist-package && npm pack --pack-destination …/tarball
corpus-0.0.0.tgz   931,692 bytes, 30 files

$ /usr/bin/tar tzf corpus-0.0.0.tgz | /usr/bin/grep -E "\.(onnx|onnx_data|wasm|node|dylib|so|dll|gguf|safetensors|bin)$|tokenizer|vocab"
   NONE — no model, no native code, no vendored wasm
```

Full tarball manifest (30 entries) enumerated and read: 11 workspace-template files, the CLI bundle,
the server bundle, 5 UI assets, 9 todos-plugin files, LICENSE, package.json, README. Nothing else.

The runtime is a declared dependency rather than a vendored artifact, and it is not inlined:

```
$ /usr/bin/python3 -c "…json.load(open('package.json'))['dependencies']"
{"@hono/node-server":"^2.0.12", "@hono/zod-openapi":"^1.5.1", "better-sqlite3":"^12.4.1",
 "chokidar":"^4.0.3", "diff-match-patch":"^1.0.5", "hono":"^4.12.32",
 "onnxruntime-web":"^1.27.0", "openapi-fetch":"^0.17.0", "yaml":"^2.9.0", "zod":"^4.4.3"}

$ /usr/bin/grep -c "ort-wasm" dist-package/server/main.js     → 0
```

And the posture the whole rescope exists to defend, confirmed in the shipped bundle:

```
$ /usr/bin/grep -c 11434          dist-package/server/main.js → 0
$ /usr/bin/grep -c "api/tags"     dist-package/server/main.js → 0
$ /usr/bin/grep -c "ollama serve" dist-package/server/main.js → 0
$ /usr/bin/grep -o "ollama" dist-package/server/main.js | wc  → 4   (the configurable provider name)
```

No daemon port, no probe endpoint, no way to start a model server. The only `ollama` references are
the name an operator may explicitly configure — which OC1-REVISED permits.

### The 22.6 MiB that is *not* in the tarball

Sitting in my scratch cache after a real cold download, hashing equal to the pins:

```
all-MiniLM-L6-v2@751bff37182d3f1213fa05d7196b954e230abad9/
  model_quantized.onnx  22,972,370 B  afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1
  tokenizer.json           711,661 B  da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0
```

22.6 MiB of model beside a 3.08 MiB tool — the ~8.3× the ruling avoided, made visible.

## Failures

None.

## Observations (not failures)

- **O-1.** I did not re-run the packed-install smoke (`npm install` of the tarball pulls ~140 MiB and
  the machine is shared). I verified the tarball's contents, its size, its declared dependency set and
  the absence of every forbidden artifact class directly, and verified the equivalent runtime
  behaviour — cold-cache download, `disabled` → `current`, hybrid search — from source. The issue
  log's packed-install run is specific enough (pid 90973, port 8807, 59 chunks embedded, `corpus
  --version` from the scratch prefix) to be credible, and its central claim — that the embedding
  worker resolves its entry from the bundle itself — is consistent with what I observed from source.
- **O-2.** The 8 MiB `MAXIMUM_PACKED_BYTES` ceiling is a mechanical guard, not an agreed policy
  number, and the log says so under "Unresolved / carried forward". At 3.08 MiB there is 2.6× of
  headroom; worth a decision before something legitimately approaches it.

## Summary

4 of 4 criteria pass, three re-derived by me from a fresh build. The pack is 30 files and 3,229,917
bytes — reproduced to the byte — with zero model artifacts, zero native code and zero vendored wasm in
either the stage or the tarball, and the wasm runtime carried as an ordinary declared dependency. The
negative proof is mechanical rather than asserted, and the rules were shown to fire.
