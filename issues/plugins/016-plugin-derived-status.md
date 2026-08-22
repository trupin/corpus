# [PLUGINS-016] A plugin doc type can derive its own status

## Domain

plugins

## Status

done

## Priority

P1

## Model

fable

## Dependencies

- Depends on: SHARED-036 (rider must be signed first)
- Blocks: SERVER-085, UI-092

## Spec References

- SPEC.md §12 — the `todo` doc type, as amended by SHARED-036
- SPEC.md §10 — plugin extension points
- SPEC.md §5 line 157 — `status` meaning per type

## Summary

SHARED-036 makes a todo document's status a reading of its items. Nothing in the
plugin system can express that today: `PluginDocType`
(`packages/kit/src/plugin/types.ts:139`) offers `ListItem`, `DocPanel` and
`validate` — all client-side — and `types.yaml`, the server- and CLI-readable
mirror, is declarative strings only. Meanwhile SPEC.md §12 makes UI checkbox
toggles **ordinary core body edits** that never touch the plugin's routes, so
there is no point on the write path where a plugin currently gets a say.

This issue adds that point, and implements it for todos.

## The one design decision, made before implementing

Two defensible homes for the derivation:

- **(A) A plugin-owned function.** Add `deriveStatus?: (doc) => DocStatus | null`
  to `PluginDocType`, and export a server-side counterpart from the plugin's
  `server/` module (which the server already dynamically imports —
  `apps/server/src/plugins/discover.ts`). The item format stays the plugin's,
  which is the boundary as drawn.
- **(B) Core reads task lists; the type opts in.** GFM task lists are already
  core — the core editor renders, toggles and serializes them, which is exactly
  why `manifest.ts` deliberately registers no `View`. So core could expose
  "task-list completion" as an ordinary document property and `types.yaml` could
  carry a declarative `statusFromTasks: true`. Far less machinery, no TS
  execution on the projection path, and the CLI gets it for free.

**Recommendation: (B).** The parse is not actually plugin-private — core owns
task-list syntax already — and (A) puts plugin TS on the projection hot path for
one boolean. Take (A) only if the sweep below finds that todos' item parsing
diverges from plain GFM task lists in a way that matters.

**Before implementing, verify against `plugins/todos/items.ts`:** does
`readItems` treat any line as an item that core's task-list parse would not, or
vice versa (fenced blocks, blockquotes, nesting, the `(due: …)` marker)? Record
the answer in this issue. A divergence decides this for you; no divergence makes
(B) correct. Escalate to the orchestrator if the answer is genuinely ambiguous
rather than picking to keep moving.

## Acceptance Criteria

- [ ] The design decision above is recorded in this file with its evidence
- [ ] A doc type can declare that its status is derived, through whichever
      mechanism the decision picks, and the declaration is readable by **both**
      the UI (from the manifest) and the server/CLI (without loading UI code) —
      the existing `parity.test.ts` invariant must still hold in both directions
- [ ] For `todo`: at least one item and no open items derives `resolved`;
      anything else derives `open`; an empty list derives `open`
- [ ] A document whose stored status is `archived` derives nothing — `archived`
      stands, per SHARED-036
- [ ] A document whose items cannot be read (the legacy `extra.items` state
      `LegacyItemsNotice` reports) derives **nothing** and falls back to the
      stored value — the same rule the DocPanel already applies to its counts
- [ ] Deleting `plugins/todos/` leaves core booting and todo documents rendering
      as ordinary markdown with working checkboxes (SPEC.md §15 M6's subtractive
      check) — derived status degrades to the stored value, it does not error
- [ ] The kit-only import rule is not weakened

## Technical Design

### Files to Create/Modify

- `packages/kit/src/plugin/types.ts` — the declaration, under whichever design
  wins
- `packages/kit/src/plugin/types.test.ts` — contract coverage
- `plugins/todos/types.yaml` — the non-TS mirror
- `plugins/todos/manifest.ts` — the TS side
- `plugins/todos/items.ts` — the derivation itself, if (A); a shared predicate
  either way
- `plugins/todos/parity.test.ts` — must still assert the two declarations agree

### Edge Cases

- A todo document with items only inside a fenced code block
- A document declaring `type: todo` with no body at all
- A plugin declaring derived status for a type it does not own — must be refused
  at discovery, containment-style (logged warning, plugin skipped), never a boot
  failure

## Testing Strategy

Vitest over the derivation function for each case in the acceptance criteria,
plus the round-trip parity test between `manifest.ts` and `types.yaml`, plus a
discovery test that a malformed declaration is contained rather than fatal.

## E2E Verification Plan

This issue lands the mechanism; SERVER-085 makes it observable end to end. Verify
here at the unit boundary and through `corpus todos list` if the CLI can already
show a document's status; leave the board-level proof to SERVER-085 and UI-092.

### Verification Steps

1. Restart the server against a real workspace holding a todo document with one
   open item
2. Check the item through the CLI (`corpus todos check …`)
3. Confirm the derivation reports `resolved` at whatever surface this issue
   reaches (CLI output or a direct call), and `open` after unchecking

## Design decision — recorded 2026-08-21

**Chosen: (A), a plugin-owned derivation.** The issue's own test decided it:
`readItems` and core's task-list parse were run side by side and they diverge.

"Core's task-list parse" is concrete: the editor parses through
`remark-parse` + `remark-gfm` (`apps/ui/src/editor/markdown/parse.ts:33-34`).
A scratch harness ran both parsers over the divergence candidates
(`parseBodyItems` vs a remark mdast walk counting `listItem.checked`):

```
AGREE    plain items                          plugin=2[_x]    core=2[_x]
AGREE    star and plus bullets                plugin=2[_x]    core=2[_x]
AGREE    capital X                            plugin=1[x]     core=1[x]
AGREE    empty checkbox no text               plugin=1[x]     core=1[x]
DIVERGE  blockquoted item                     plugin=1[x]     core=2[x_]
AGREE    fenced example                       plugin=1[x]     core=1[x]
DIVERGE  unclosed fence then item             plugin=1[_]     core=0[]
AGREE    indented code, no list open          plugin=0[]      core=0[]
AGREE    nested subtask (4-space, list open)  plugin=2[x_]    core=2[x_]
DIVERGE  ordered task item                    plugin=0[]      core=1[_]
AGREE    due marker                           plugin=1[_]     core=1[_]
AGREE    tab-indented lone item               plugin=0[]      core=0[]
```

Three line-level divergences, each able to break the rider's core promise
("the same reading of the body that the stats panel already shows and the two
can therefore never disagree"):

- **Blockquote** — `- [x] a` plus `> - [ ] quoted`: the panel says 0 open /
  1 done, so the chip must read `resolved`; a core-GFM derivation reads `open`.
- **Unclosed fence** — `items.ts` bounds it to its own line (FIX 7);
  CommonMark/remark swallow to EOF. ` ``` ` then `- [x] done`: panel counts
  1 done → `resolved`; core counts nothing → `open`.
- **Ordered task item** — `1. [ ] x` is a GFM task item to remark and not an
  item to the plugin.

Two structural divergences no core body parse can express at all, both
acceptance criteria: an unmigrated document's items live in the legacy
`extra.items` frontmatter (the panel counts them; a body parse sees an empty
list), and a malformed legacy key must derive **nothing** — a state defined
entirely by the plugin-private `LEGACY_ITEMS_KEY` parse. The `(due: …)` marker
and nesting agree and decide nothing. Not ambiguous, so not escalated: the
divergence is in three of the four categories the issue named.

The (B)-flavored concern — plugin TS on the projection hot path — is bounded:
the derivation is `readItems` plus an `every()`, pure, no I/O, the same work
the DocPanel already does per render, and the server executes it through the
same dynamic-import convention it already uses for `server/routes.ts`.

### The seam, as landed (what SERVER-085 and UI-092 consume)

- **UI declaration**: `PluginDocType.deriveStatus?: (doc: Doc) =>
  DerivedDocStatus | null` (`packages/kit/src/plugin/types.ts`), where
  `DerivedDocStatus = Exclude<DocStatus, "archived">`. `null` = derivation
  does not apply (stored `archived`, or unreadable items) — every caller
  composes `deriveStatus(doc) ?? doc.frontmatter.status`.
- **Non-UI declaration**: `derivedStatus: true` on the type's entry in
  `types.yaml` (`z.literal(true)` — absent means not derived, `false` is not a
  spelling). Verified tolerated by today's readers: both the server's and the
  CLI's `TypesFileSchema` are non-strict `z.object`, and a real boot logged
  zero warnings.
- **Non-UI executable**: default export of `plugins/<dir>/server/derive.ts`
  (compiled `dist/server/derive.js`), signature
  `(input: {type, status, body, extra?}) => "open" | "resolved" | null` —
  structurally typed, same duck-typing rationale as `PluginRoutesFactory`.
  SERVER-085 should import it under the routes module's containment rules
  (load failure / non-function / throw / out-of-range answer → warning +
  stored value stands, never a boot or write failure) and call it only for
  documents whose type that plugin's own `types.yaml` flags — the ownership
  refusal by construction; the module self-guards on `type` anyway.
- **Parity**: `plugins/todos/parity.test.ts` pins all three pairwise —
  manifest ⟷ yaml (function iff flag, both directions, per type) and
  manifest ⟷ server module (identical answers over the rider matrix).
  `plugins/_fixture/parity.test.ts` carries the manifest ⟷ yaml invariant as
  the template.
- **Discovery refusal (UI half)**: `apps/ui/src/plugins/validate.ts` refuses a
  non-function `deriveStatus` (whole manifest invalid → plugin skipped, logged
  warning); a derivation riding on a contested doc-type claim is skipped with
  the claim by the existing registry containment
  (`apps/ui/src/plugins/registry.test.ts` pins it).

## E2E Verification Log

**Model: Fable 5 (claude-fable-5), as recommended.** All commands real, output
verbatim, 2026-08-21.

**Unit + parity + discovery** — `VITEST_MAX_THREADS=4 npx vitest run
packages/kit plugins apps/ui/src/plugins` → `Tests 1473 passed (1473)`.
Falsification: breaking the empty-list rule failed 2 tests
(`items.test.ts` deriveStatus block); breaking the archived guard failed 2
(`items.test.ts` + parity's concrete-answers test). Both restored, re-run
green. Typecheck (kit, todos, _fixture, ui) exit 0; eslint clean; prettier
clean after one `--write` on `items.test.ts`.

**Real-app drill** (scratch workspace, port 8971 — never 8765):

1. `corpus init p016-ws --port 8971`, seeded `errands.md` (`type: todo`, one
   open item), `corpus server start` → boot log shows
   `plugin discovered … "todos" … types:["todo"]` with **no warning** about
   the new `derivedStatus` key.
2. `corpus todos check doc_p016aa 1` → `checked item 1 of Errands`. Derivation
   against the doc **served by the real API**
   (`server/derive.ts` over `GET /api/docs/doc_p016aa`):
   `stored=open derived=resolved body="- [x] Renew the passport\n"`.
3. `corpus todos check doc_p016aa 1 --uncheck` →
   `stored=open derived=open body="- [ ] Renew the passport\n"`.
   (Stored stays `open` on disk — the frontmatter write-back is SERVER-085's,
   per SHARED-036's adjudication.)

**Subtractive check (SPEC §15 M6)** — `plugins/todos/` moved aside, server
restarted: boots clean (only `_fixture` discovered), `GET /api/docs/doc_p016aa`
→ 200, `GET /api/x/todos/lists` → 404. Vite + Playwright against the real
board: document opens in the core editor — `checkboxes=1 todoPanel=0
hasItemText=true pageErrors=[]`, and the checkbox **works**:
`checkedAfterClick=true`, with `- [x] Renew the passport` confirmed written to
disk by the core body-edit path. Directory restored, Vite restarted:
`todoPanel=1 open=0 done=1` — the panel returns with the stats matching the
file. All processes killed (vite pids 1883/4066, server pids 97653/1450),
ports 5273/8971 verified free; scratch scripts deleted.

## Files changed

- `packages/kit/src/plugin/types.ts`, `index.ts`, `types.test.ts`
- `plugins/todos/items.ts` (+ `items.test.ts`), `manifest.ts`, `types.yaml`,
  `parity.test.ts`, `server/derive.ts` (+ `server/derive.test.ts`)
- `plugins/_fixture/parity.test.ts`
- `apps/ui/src/plugins/validate.ts` (+ `validate.test.ts`),
  `registry.test.ts` (test only)

## Completion Checklist (domain agent)

- [x] Design decision recorded with evidence from `items.ts`
- [x] Tests written and passing
- [x] `/lint` passes (eslint + prettier + tsc over the touched workspaces)
- [x] E2E verification log filled in
- [x] Subtractive check (delete the plugin) still passes
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (cross-domain: kit + plugins + server contract)
- [ ] `/evaluate` passes
- [ ] Committed with `[PLUGINS-016]` prefix
