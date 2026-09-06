# [CONTRACT-098] Frontmatter key classes are declared once, where both sides can import them

## Domain

contract

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: CLI-083, UI-189 (their comparison must import these sets, never
  restate them)

## Spec References

- SPEC.md **§5** — server-stamped core fields; **§10** — presentation state on
  view documents

## Summary

Filed from sprint-024's pre-flight (E1/P3). Two frontmatter key classes exist
today with no importable home:

- **Server-stamped keys** (`updated:` foremost) — stamped by the server, not
  authored. CLI-083 needs the set to ignore them in the template comparison.
- **Presentation keys** (`width`) — already a module-local `PRESENTATION_KEYS`
  const in `apps/server/src/docs/update.ts`, which `apps/cli` cannot import
  (dependency direction: `packages/contract` ← `apps/server` / `apps/cli`).

UI-189's direction-2 decision and CLI-083 both need one declaration both the
server's stamping rule and the CLI's comparison read. Restating either set in
`apps/cli` is a third copy of the same meaning and a drift waiting to happen.

## What to build

In `packages/contract`: exported, documented sets (named exports, `as const`)
for server-stamped frontmatter keys and presentation frontmatter keys. The
server's existing uses (stamping, `PRESENTATION_KEYS`) switch to importing
them, with a drift test on the server side proving the local const is gone.
No route or schema changes. No behaviour change anywhere — this issue is the
declaration and the re-pointing only.

## Acceptance Criteria

- [x] Both sets exported from `packages/contract` with doc comments naming
      what qualifies a key for each
- [x] `apps/server` imports them; no module-local restatement survives
- [x] A drift test fails if a key is added in one place only
- [x] `npm run build` and the OpenAPI drift check are clean (no generated
      surface changes expected)

## Decisions recorded

**Where the declaration lives.** `packages/contract/src/schemas/frontmatter-keys.ts`,
a new module exported through `schemas/index.ts`. It follows the
`UNSETTABLE_EXCLUSIONS` precedent exactly — an `as const` tuple in the contract
that `apps/server` and `apps/cli` both import — rather than the
`RESERVED_FRONTMATTER_KEYS` precedent of a list private to the module whose
schema uses it. Neither class is a wire shape, so neither is a Zod schema and
neither reaches `openapi.json`.

**Names.** `SERVER_STAMPED_FRONTMATTER_KEYS` and `PRESENTATION_FRONTMATTER_KEYS`,
with `isServerStampedFrontmatterKey` / `isPresentationFrontmatterKey` beside
them. Sprint-024 S1 illustrated `SERVER_STAMPED_KEYS` / `PRESENTATION_KEYS`
("names illustrative, the declaration is not"); the `_FRONTMATTER_KEYS` suffix
matches the two neighbours already in the contract namespace
(`RESERVED_FRONTMATTER_KEYS`, `CLEARABLE_FRONTMATTER_KEYS`), which a bare
`PRESENTATION_KEYS` would not.

**The predicates exist so no consumer builds a second `Set`.** A derived lookup
structure is where a filtered or extended copy starts. The tuples stay exported
for enumeration — a consumer that ignores both classes unions the tuples at its
own call site.

**`UPGRADE_IGNORED_KEYS` is deliberately not exported.** S1's illustrative shape
listed the union as a third constant. It is derived, it is named for one
consumer's use rather than for a property of the keys, and CLI-083 can form it
in one expression. A third exported list is the thing this issue exists to
avoid.

**Membership of the stamped class: `created` and `updated`.** The rule is *the
server writes the value from its own clock, and no request may set it*.
"Stamp" is the codebase's own word for exactly this (`stampUpdated`,
`updated: stamp` in `create.ts` and `capture.ts`). The near misses are named in
the docblock so the next key does not have to be argued from scratch:

- `reviewed` is a timestamp but a **person** sets it — it travels on
  `UpdateDocRequest`, so its value is an authored act.
- `anchors`, `origin` and `turnModels` are server-maintained but are not
  stamps: they record *what* the server did, not *when*, and a difference in one
  of them is a real difference in the document. Widening the class to them would
  make an upgrade comparison ignore a difference a person caused.
- `id` and `type` are identity and behaviour.

`created` overlaps `UNSETTABLE_EXCLUSIONS` and the overlap is asserted rather
than tidied away: the two lists mean different things and happen to agree on one
key.

**Membership of the presentation class: `width` alone**, carried over verbatim
from the docblock that was in `apps/server/src/docs/update.ts`, with two
additions — the CLI consumer, and the structural fact that presentation keys are
**extra** keys (absent from `RESERVED_FRONTMATTER_KEYS`, written as
`PUT { extra: { width } }`) while stamped keys are all **core** keys. That is why
the two lists cannot be checked by one rule.

**No behaviour changed.** `isContentEdit` computes exactly what it computed
before. `apps/server`'s 4875 tests pass unchanged, including the eight cases in
`update.test.ts`'s "`updated` is when the content changed" block.

## E2E Verification Log

**Model: Opus 5 (`claude-opus-5[1m]`).** Agent: contract-dev, in an isolated
worktree. No git command was run.

### Environment note, recorded because it silently produced a wrong result first

The worktree has no `node_modules` of its own, so `@corpus/contract` resolved
**up into the main checkout's** `node_modules/@corpus/contract` symlink — that
is, into the main repo's `packages/contract/dist`, which does not carry this
change. The first `apps/server` run therefore failed 30 tests with
`TypeError: isPresentationFrontmatterKey is not a function` while
`npm run build` reported success and the contract's own tests (relative imports)
were green. Fixed by creating the five `@corpus/*` symlinks inside the
worktree's own `node_modules` (gitignored, no repo change). Any worktree-isolated
agent whose change crosses a workspace boundary needs this, and the failure looks
like a bug in the change rather than in resolution.

`react-router@^8.3.0` is absent from the shared `node_modules`, so
`npm run build` fails at the `apps/ui` vite step. Pre-existing and unrelated:
`packages/contract`, `packages/kit`, `apps/cli` and `apps/server` all build. No
`npm install` was run, to avoid disturbing concurrent agents on the shared tree.

### Checks

| Command | Result |
| --- | --- |
| `npm run build` (contract → kit → cli → server) | exit 0 for all four; `apps/ui` fails on the missing `react-router`, pre-existing |
| `npm run typecheck -w packages/contract -w apps/server` | exit 0 |
| `eslint` over the six touched files | exit 0 |
| `prettier --check` over the six touched files | clean |
| `vitest run packages/contract` | **73 files, 3159 tests, all passed** |
| `vitest run apps/server` | **214 files, 4875 tests, all passed** |

### OpenAPI drift check

`packages/contract/src/generation/artifacts.test.ts` — the one test in the
package that reads the **committed** `openapi.json` and `schema.generated.ts`
rather than the in-memory document — passed (11 tests). No generated surface
changed, as expected: neither list is a schema and no route was touched.

### The drift tests were falsified, three ways

Scratch edits, each reverted and re-verified green afterwards.

**1. A key added to the stamped class that does not satisfy its rule.** Added
`"reviewed"` to `SERVER_STAMPED_FRONTMATTER_KEYS`, rebuilt the contract:

```
× frontmatter key classes (CONTRACT-098) > pins both lists …
× frontmatter key classes (CONTRACT-098) > answers membership for every declared key, and for nothing else
× … > `reviewed` is refused as an update field — the server is its only writer
× … > keeps `reviewed` out of the stamped class, because a person sets it
× server-stamped frontmatter keys are written by the server alone > refuses a `PUT` naming `reviewed`, so the file keeps the server's value
Tests  5 failed | 14 passed (19)
```

Both sides fail, and every failure names `reviewed`.

**2. The drift the issue removes: a module-local restatement that goes stale.**
Re-added `const PRESENTATION_KEYS = new Set(["width"])` to `update.ts` **and**
added `"height"` to the contract's presentation list — the "added in one place
only" state:

```
× presentation frontmatter keys are the contract's, not this module's > a save of only `height` writes the file and leaves `updated` where it was
× presentation frontmatter keys are the contract's, not this module's > holds no quoted presentation key of its own in `update.ts`
Tests  2 failed | 5 passed (7)
```

The behaviour test names `height` — the key the server is behind on — which is
the message saying which side is behind. The source scan independently names the
restatement.

**3. The source scan alone.** Falsified by the same edit: the scan fired on the
re-added `new Set(["width"])` while the contract still declared only `width`, so
it catches a restatement that has not yet diverged.

### What the tests hold, stated plainly

- `packages/contract/src/schemas/frontmatter-keys.test.ts` (10 tests) — pins
  both lists, holds them disjoint, and checks each **membership rule** against
  the rest of the contract: every stamped key is a core key that
  `UpdateDocRequestSchema` refuses, every presentation key is an extra key that
  `UpdateDocRequestSchema` refuses at the top level and accepts inside `extra`,
  and `reviewed` is accepted as an update field (which is why it is not stamped).
- `apps/server/src/docs/frontmatter-key-classes.test.ts` (6 tests) — drives
  every assertion by **iterating the contract's own list**, so it names the key
  the server is behind on. Covers: a save of only a presentation key leaves
  `updated` where it was, a non-listed extra key still stamps it, a `PUT` naming
  a stamped key is refused with `400` and the file keeps the server's value, a
  content edit stamps `updated` and leaves `created` alone, and `update.ts`
  holds no quoted presentation key of its own.

### Not done, and why

- **`apps/cli` untouched**, per the issue's scope. CLI-083 and UI-189 import
  these two lists and form the union themselves.
- **The stamped class has no *behavioural* consumer in `apps/server` today** —
  its consumer is the CLI's template comparison. The server consumes it in the
  drift test, which pins the declaration against the server's real behaviour.
  Writing `{ [SERVER_STAMPED_FRONTMATTER_KEYS[1]]: formatInstant(now) }` at the
  ten sites that stamp `updated` would be obfuscation, not a re-point.
