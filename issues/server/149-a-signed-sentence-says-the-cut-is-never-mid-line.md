# [SERVER-149] A signed sentence says the cut is never mid-line, and the code keeps a fallback that is

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-032
- Blocks: —

## Spec References

- SPEC.md **§9.2**, signed rider 2026-08-05 — "The cut is never mid-line, and
  never mid hunk-header: a truncated diff is always something a reader can read."

## Summary

Found by cli-dev while closing CLI-028, and it is the release's own sentence
turned on the spec itself.

`truncateDiff` cuts at the last line boundary at or before the bound, which
obeys the rider. It also keeps a documented **fallback that cuts at `max`** when
no line boundary exists at or before it — a mid-line cut, which the rider says
never happens.

**Today that fallback is unreachable through the route, and only by accident.**
The first newline in a real `git diff` falls at index 90, inside the
`diff --git a/… b/…` header, so `lastIndexOf("\n", max - 1)` never returns `-1`.
That is a property of git's output format, not a guarantee this codebase makes or
controls.

So SPEC.md states a rule unconditionally and the code keeps an escape from it.
Either the sentence is wrong or the code is. **The decision taken is: the code is
wrong.** The rider's stated reason — "a truncated diff is always something a
reader can read" — is a deliberate choice, and a mid-line prefix of a diff is not
readable as a diff. Obeying a signed sentence costs nothing reachable and spends
no signature.

The alternative was drafted and rejected, and is recorded here so it can be
reversed cheaply if this proves wrong:

> "The cut is never mid-line and never mid hunk-header, except where a single
> line is longer than the whole bound — there the diff is cut at the bound,
> because a long line's beginning is worth more than nothing."

## Acceptance Criteria

- [x] `truncateDiff` never returns a mid-line prefix. Where no line boundary
      exists at or before the bound, it returns what the boundary rule permits —
      not `max` characters of a line
- [x] `truncated` and `totalChars` still describe the answer honestly in that
      case, so a caller cannot read a short answer as a complete one
- [x] The docblock stops describing a fallback the function no longer has
- [x] A test covers the no-boundary input directly, since the real route cannot
      produce one

## Technical Design

**Stop and report rather than guessing if a caller loses real information.**
`truncateDiff`'s only known caller is the diff route, where git's header makes
the case unreachable. If the sweep finds a second caller that can hand it a
newline-free payload and genuinely needs a prefix, do not implement — report it,
because then the drafted rider above is the right answer and it needs the user's
signature.

## Testing Strategy

Falsify by restoring the mid-line fallback and asserting the new test goes red.

## E2E Verification Log

Implemented by **server-dev on opus** (claude-opus-5[1m]), 2026-08-24, branch
`phase-45-not-so`.

### Caller sweep — done before implementing, and it found nothing that loses

`grep -rn "truncateDiff"` across the repo (excluding `node_modules`, `dist/` and
other agents' worktrees) returns exactly one production call site:

- `apps/server/src/edit/diff.ts:360` — `readDocDiff`, whose argument is
  `await readRangeDiff(...)`, i.e. `git diff`'s own stdout.

Everything else is prose (`packages/contract/src/schemas/edit.ts:408`, issue
files) or the function's own tests. `apps/server/src/edit/index.ts` re-exports
`truncateDiff` and `BoundedDiff`, and **no module outside `edit/` imports
either** — `grep -rn "BoundedDiff"` returns only the declaration, the return
type and that re-export. So no second caller exists, none can hand it a
newline-free payload, and the drafted alternative rider is not needed. Proceeded
as instructed.

### The change

`truncateDiff` (`apps/server/src/edit/diff.ts:218`) now returns `""` where
`lastIndexOf("\n", max - 1)` finds no boundary, instead of `text.slice(0, max)`:

```ts
const newline = max > 0 ? text.lastIndexOf("\n", max - 1) : -1;
const diff = newline === -1 ? "" : text.slice(0, newline + 1);
return { diff, truncated: true, totalChars };
```

The `max > 0` guard is the same rule at the other end: `lastIndexOf` clamps a
negative `fromIndex` to 0 rather than searching nothing, so a leading newline
would otherwise answer a bound of zero with one character. The docblock's
closing paragraph no longer describes a fallback, and states instead why the
case is unreachable through the route and why the rule is obeyed anyway.

### `truncated` / `totalChars` in the no-boundary case — still honest

Exercised directly through `tsx`, since the route cannot produce the input:

```
no-boundary input, max 50        -> {"diff":"","truncated":true,"totalChars":200}
boundary past the bound, max 100 -> {"diff":"","truncated":true,"totalChars":212}
same input, max 201              -> {"diff":"@@@…@@@\n", truncated:true}   (whole first line)
```

The empty diff never travels alone: `truncated: true` says it was cut and
`totalChars` names the full size, which is exactly the pair
`DocDiffSchema.truncated` relies on to stop a caller reading a short answer as a
complete one. The one ambiguity the contract already carries — `diff: ""` also
means "nothing changed in the range" — is resolved by `truncated`, which is
`false` in that case and `true` in this one.

### Falsification — the new tests do go red

Restored the mid-line fallback (`newline === -1 ? text.slice(0, max) : …`) and
re-ran the file:

```
EXIT=1
 × returns nothing rather than a mid-line prefix when no line boundary fits
   → expected { …(3) } to deeply equal { diff: '', truncated: true, …(1) }
 × keeps only whole lines when the first boundary sits past the bound
   → expected '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@…' to be ''
      Tests  2 failed | 15 passed (17)
```

The third new case (zero bound) passes either way by construction — it pins the
`lastIndexOf` clamp, not the fallback. Fix restored, `EXIT=0`, 17/17.

### Real server, real HTTP — the reachable path is unchanged

Real workspace at `…/scratchpad/ws` (`corpus init`, git initialised), real
server on port 8791 (pid 55963, `corpus server start`, health `200`). Created a
900-paragraph document over HTTP (`POST /api/docs` →
`data/docs/inbox/truncation-probe.md`), then `GET /api/docs/{id}/diff`:

```
HTTP 200
from 4b825dc642cb6eb9a060e54bf8d69288fbee4904 to 918d6a5306021a935dc699f78d20c65ceac2f022
stats {"commits":1,"insertions":1813,"deletions":0}
truncated true  totalChars 66045  diff.length 15941
endsWithNewline true
firstNewlineIndex 86
firstLine "diff --git a/data/docs/inbox/truncation-probe.md b/data/docs/inbox/truncation-probe.md"
unspentBudget 59
```

Two things measured rather than assumed. **The budget is still spent**: 15,941
of 16,000, the 59 unspent characters being shorter than the next line — the
CONTRACT-032 behaviour, untouched. **The fallback really was unreachable**: the
first newline of git's output lands at index 86 here (the issue measured 90;
the difference is the path's length inside the `diff --git` header), so
`lastIndexOf("\n", 15_999)` can never return `-1` on this route. Server stopped
afterwards, port 8791 verified free.

### Checks

- `eslint` on both changed files — clean, no rule disabled.
- `prettier --check` on both — clean.
- `npm run typecheck -w apps/server` — `EXIT=0`.
- `VITEST_MAX_THREADS=4 vitest run --reporter=verbose apps/server` —
  `EXIT=0`, **205 files, 4673 tests passed**, 125.77 s. `truncateDiff` 12 → 14
  cases (one replaced, three added).
