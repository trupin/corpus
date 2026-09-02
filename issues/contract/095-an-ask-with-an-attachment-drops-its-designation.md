# [CONTRACT-095] An Ask that carries an attachment drops its designation entirely

## Domain

contract

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: `UI-185` (the weight the designation now carries is one more thing
  this path drops, and the UI change is what made the loss visible)
- Related: CONTRACT-088 (`MultipartResidentSchema`, which the server already
  accepts), SHARED-073 (Rider A — Ask offers a new resident)

## Spec References

- SPEC.md **§7** — only a standalone thread designates, and a resident's weight
  is set when it is designated
- SPEC.md **§10** — Capture carries a weight exactly as Ask does

## Summary

Found while implementing `UI-185`, 2026-09-01. **The multipart create-thread
path carries no `resident` at all**, so an Ask with an attachment silently
discards the owner the person picked — and now the weight they picked for it too.

The server is not the problem. `MultipartResidentSchema` (CONTRACT-088) already
accepts `resident` as one JSON-encoded part, wrapping `CreateThreadResidentSchema`
with its three states and its `weight` field. The route reads it. **The client
never sends it:**

| Layer | Carries `resident`? |
| --- | --- |
| `MultipartResidentSchema` / the route (server) | **yes** |
| `ThreadUpload` (`packages/contract/src/client/upload.ts:82`) | **no** |
| `buildThreadFormData` (same file, line 155) | **no** |
| `CreateThreadUpload` (`packages/kit/src/client/createCorpusClient.ts:149`) | **no** |
| The JSON twin (`POST /api/threads` without files) | **yes** |

So the same Ask, with and without a file attached, creates two different threads
from the same form. Nothing tells the person which one they got.

## Why this is P0

**It makes the v0.31.0 headline false in a case people hit.** The release is
named for being able to say what a resident runs at. Attach a screenshot to the
question and the resident is not designated at all, let alone weighted.

**It is silent in the worst direction.** The thread is created, so the send
succeeds and looks right. The designation is simply absent, and §7 makes that
absence expensive: only a standalone thread may designate, and this thread has
already been created without one.

**The wire already agreed.** This is a client that forgot a field its own server
documents, which is the class of drift the contract-first decision exists to make
impossible — and it survived because no test sends a file and an owner together.

## Acceptance Criteria

- [x] `ThreadUpload` carries `resident` with the same three states the JSON body
      has — omitted, `null`, an object — and the object carries `weight`
- [x] `buildThreadFormData` serialises it as **one JSON-encoded part**, matching
      `MultipartResidentSchema`, and **omits the part entirely** when the field is
      omitted. An omitted part and a `null` part mean different things and the
      encoding must keep them apart
- [x] `CreateThreadUpload` and `createThreadWithFiles` carry it through
- [x] The global composer's Ask sends the same `resident` object on both paths —
      the value `designationRequest` already builds, not a second construction
- [x] A test sends **a file and an owner together** and asserts the part is on the
      wire, because the absence of exactly that test is why this shipped
- [x] A test pins the three states through the multipart encoding specifically:
      omitted sends no part, `null` sends `null`, an object sends the object
- [x] The JSON path is unchanged

## Technical Design

### Files to Create/Modify

- `packages/contract/src/client/upload.ts` — `ThreadUpload.resident` and
  `buildThreadFormData`
- `packages/kit/src/client/createCorpusClient.ts` — `CreateThreadUpload` and
  `createThreadWithFiles`
- `apps/ui/src/compose/` — the upload branch of the overlay's submit
- Tests beside each, plus an `apps/ui/e2e/` case that attaches a file

### Notes

- **Serialise, do not flatten.** `MultipartResidentSchema`'s own docblock says
  why: flat parts cannot express *present, and explicitly nobody*. One encoded
  value is the decision, not a convenience.
- The selector part is the pattern to copy — it is already a JSON-encoded part in
  the same builder.

## Testing Strategy

Unit tests over `buildThreadFormData` reading the produced `FormData` back, one
per state. A kit client test that the field survives the hop. A browser spec that
attaches a file, picks an owner and a weight, and asserts what leaves on the wire
— the assertion that would have caught this. Falsify by dropping the part from
the builder and confirming the wire test goes red.

## E2E Verification Log

_Filled by the implementing agent; state the model._

**Implemented by contract-dev on Opus 5 (1M context), 2026-09-01.**

**Pre-fix reproduction, 2026-09-01 (ui-dev, Fable 5), by reading the code:**
`uploadCreateThread` posts `buildThreadFormData(options)`, and neither
`ThreadUpload` nor the builder mentions `resident`. A running-app confirmation —
attach a file to an Ask with an owner picked, and read the created thread's
frontmatter — belongs in this log before the fix lands.

### Pre-fix reproduction against a real server

A real workspace (`corpus init --port 8931`), a real server (`corpus server
start`, pid 18906), and the **real multipart client** — `uploadCreateThread` out
of `packages/contract/dist` with the pre-fix builder rebuilt in place. One file
and `resident: {weight: "heavy"}`, which is what the composer sends after
picking a level.

The thread was created and the file landed. The designation did not:

```
pre-fix: response resident = {"name":null,"docId":null,"weight":null,"designationId":"des_7zeai2xoidpr"}

# data/threads/th_nfui6kst.md
resident:
  name: null
  docId: null
  designationId: des_7zeai2xoidpr
```

`corpus thread show th_nfui6kst` → `resident a general resident`. **The level the
person picked is not on disk and not in the answer**, which is the v0.31.0
headline being false in a case people hit.

The second state is worse than a loss, it is an inversion. `resident: null` —
*nobody owns this* — reached the server as no part at all, which the route reads
as the default, so the thread was designated a general resident anyway:

```
pre-fix-nobody: response resident = {"name":null,"docId":null,"weight":null,"designationId":"des_7csl7jjqgqbw"}
```

### Post-fix, same server, same client, same requests

```
post-fix: response resident = {"name":null,"docId":null,"weight":"heavy","designationId":"des_cjlaldz3mj4s"}

# data/threads/th_id6d6w4w.md
resident:
  name: null
  docId: null
  weight: heavy
  designationId: des_cjlaldz3mj4s

$ corpus thread show th_id6d6w4w
resident a general resident at heavy
![shot.png](attachments/th_id6d6w4w/2026-09-02T00%3A28%3A10Z/shot.png)
```

…and *nobody* now means nobody: `post-fix-nobody: response resident = null`, with
no `resident` key in the created thread's frontmatter at all. The attachment
rode along on every one of the four requests (`.corpus/attachments/<id>/<ts>/shot.png`).

The scratch server was stopped (`stopped (pid 18906)`) and port 8931 confirmed
free. The user's server on 8765 was never touched.

### Encoding

One JSON-encoded part named `resident`, matching `MultipartResidentSchema` and
copying the `selector` part in the same builder. **Omitted sends no part**;
`null` sends the part `null`; an object sends the object. Nothing is flattened —
flat parts cannot say *present, and explicitly nobody*.

### Falsification (mandatory, and it fired)

Deleted the one line from `buildThreadFormData`
(`form.append("resident", JSON.stringify(upload.resident))`), rebuilt every
workspace so `dist/` really carried the regression — the kit-dist trap — and
re-ran:

- **12 red across three layers**: 6 in `packages/contract/src/client/upload.test.ts`
  (4 builder, 2 mounted-route round trips), 2 in
  `packages/kit/src/client/turnWrites.test.ts`, 2 in
  `packages/kit/src/query/useCreateThread.test.tsx`, 2 in
  `apps/ui/src/compose/ComposeOverlay.test.tsx`.
- **Playwright**: `ask-designation-weight.spec.ts` went `PASS (4) FAIL (2)` —
  both new wire cases red, on a rebuilt `dist/`.
- The three "omits the part when the field is omitted" assertions stayed green,
  which is correct: they assert an absence the regression also produces. They are
  there to pin the default, not to catch this.

The builder was restored, every workspace rebuilt, and all of it re-run green.

### Green runs (after the fix, on a rebuilt tree)

- `vitest run packages/contract packages/kit/src/query packages/kit/src/client apps/ui/src/compose`
  → **100 files, 3435 tests passed** (includes `generation/artifacts.test.ts`, so
  the committed `openapi.json` and client types are checked: this change adds no
  schema, and both artifacts are byte-identical).
- `playwright test ask-designation-weight.spec.ts attachments.spec.ts resident.spec.ts recipient.spec.ts stub-fidelity.spec.ts`
  → **PASS (41) FAIL (0)**, `CORPUS_UI_PORT=5273`.
- `npm run lint` → clean. `npm run format:check` → clean.
  `npm run typecheck -w packages/contract -w packages/kit -w apps/ui` → clean.

### Note on the layer that needed no change

`apps/ui/src/compose` was already correct: `ComposeOverlay` sends
`designationRequest(resident, residentWeight)` on **one** submit path, and
`useCompose` spreads it onto the mutation regardless of files. The field was
dropped one layer down, in `useCreateThread`'s multipart branch and in the two
client shapes below it. No second designation object was built.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
